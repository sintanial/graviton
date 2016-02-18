'use strict';
const fs = require('fs');
const URL = require("url");

const debug = require('debug')('graviton:debug');
const log = require('debug')('graviton:log');

const shortid = require('shortid');
const jsesc = require('jsesc');
const _ = require("lodash");

const errors = require("./error");


const electron = require('electron');
const app = electron.app;  // Module to control application life.
const BrowserWindow = electron.BrowserWindow;
const session = electron.session;
const ipcMain = electron.ipcMain;

const JsError = errors.JsError;
const ElectronError = errors.ElectronError;
const GravitonError = errors.GravitonError;

var isAppReady = false;
var preload = __dirname + "/preload.js";

app.on('window-all-closed', function() {});

class Graviton {

    /**
     * Create new Graviton instance and return Promise which executed after event app.ready is fired
     * @param options
     * @returns {Promise}
     */
    static new(options) {
        return new Promise((resolve, reject)=> {
            if (isAppReady) {
                resolve(new Graviton(options));
            } else {
                app.on("ready", ()=> {
                    isAppReady = true;

                    resolve(new Graviton(options));
                });
            }
        });
    }

    /**
     * Create new Graviton instance
     * options.waitTimeout - timeout after which, wait throw GravitonError
     * options.electron - options for electron BrowserWindow
     * options.headers - default headers, which set for all requests
     * @param options
     */
    constructor(options) {
        var self = this;

        this.sessid = shortid.generate();
        options = this.options = _.defaultsDeep(options, Graviton.defaults);

        if (options.electron.webPreferences.session == undefined) {
            // может постепенно забивать память
            options.electron.webPreferences.session = session.fromPartition(this.sessid);
        }

        var proxy = null;
        if (options.proxy) {
            proxy = URL.parse(options.proxy);
            options.electron.webPreferences.session.setProxy("http=" + proxy.host);
        }

        options.electron.webPreferences.preload = preload;
        var win = this.win = new BrowserWindow(options.electron);
        var wc = win.webContents;

        if (proxy != null) {
            wc.on("login", (event, request, info, auth)=> {
                if (info.isProxy) {
                    event.preventDefault();
                    var cred = proxy.auth.split(":");
                    auth(cred[0], cred[1]);
                }

            });
        }

        wc.setAudioMuted(true);
        if (options.useragent != undefined) {
            this.useragent(options.useragent)
        }

        win.on('closed', function () {
            debug("window closed");

            self.win = null;
            win = null;
        });

        this._isDomReady = false;
        this._isFinishLoaded = false;
        this._lastFatalError = null;

        wc.on('did-finish-load', function () {
            //log('did-finish-load');

            self._isFinishLoaded = true;
        });
        wc.on('did-fail-load', function (event, code, desc, url) {
            if (~[-3].indexOf(code)) return;

            //log('did-fail-load', code, desc, url);

            self._lastFatalError = new ElectronError("failed to load page", code, desc);
        });
        wc.on('dom-ready', function () {
            //log('dom-ready');

            self._isDomReady = true;
        });
        wc.on('will-navigate', function () {
            //log('will-navigate');

            self._isDomReady = false;
            self._isFinishLoaded = false;
            self._lastFatalError = null;
        });

        wc.on('did-finish-load', function () {
            log('did-finish-load');
        });
        wc.on('did-fail-load', function () {
            log('did-fail-load');
        });
        wc.on('did-frame-finish-load', function () {
            log('did-frame-finish-load');
        });
        wc.on('did-start-loading', function () {
            log('did-start-loading');
        });
        wc.on('did-stop-loading', function () {
            log('did-stop-loading');
        });
        wc.on('did-get-response-details', function () {
            log('did-get-response-details');
        });
        wc.on('did-get-redirect-request', function () {
            log('did-get-redirect-request');
        });
        wc.on('dom-ready', function () {
            log('dom-ready');
        });
        wc.on('page-favicon-updated', function () {
            log('page-favicon-updated');
        });
        wc.on('new-window', function () {
            log('new-window');
        });
        wc.on('will-navigate', function () {
            log('will-navigate');
        });
        wc.on('crashed', function () {
            log('crashed');
        });
        wc.on('plugin-crashed', function () {
            log('plugin-crashed');
        });
        wc.on('destroyed', function () {
            log('destroyed');
        });
    }

    /**
     * Open passed url in electron
     *
     * @param url
     * @param headers - Additional headers to requests
     * @param etype - Type of event, which means that page is loaded and execute promise. Can be dom|loaded
     * @returns {Promise}
     */
    goto(url, headers, etype) {
        if (typeof  headers == "string") {
            etype = headers;
            headers = {};
        }

        var self = this;
        return new Promise((resolve, reject)=> {
            debug("goto %s", url);

            self.win.webContents.loadURL(url, {
                extraHeaders: _.defaults(headers, Graviton.defaults.headers)
            });

            self.win.webContents.once(etype == "dom" ? "dom-ready" : 'did-finish-load', () => {
                debug("finish load %s", url);
                resolve(self);
            });

            self.win.webContents.once('did-fail-load', (event, code, desc) => {
                reject(new ElectronError("failed to load page", code, desc));
            });
        });
    }

    send(event, messages) {
        this.win.webContents.send.apply(self.win.webContents.send, arguments);
    }

    /**
     * Evaluate javascript on page
     * @param js - javascript function
     * @returns {Promise}
     *
     * @todo если js - строка, то необходимо в качестве аргумента передавать объект с параметрами {ключ: значение}
     */
    evaluate(js/*, arg1, arg, etc*/) {
        var self = this;
        return new Promise((resolve, reject) => {
            var script;
            if (typeof js == "string") {
                js = js.replace(/'/g, "\\'");
                script = `function(){eval('${js}')}`;
            } else {
                script = String(js);
            }
            var prefix = self.sessid + "|";
            var args = JSON.stringify(Array.prototype.slice.call(arguments).slice(1)).slice(1, -1);

            debug("evaluate script %s with args %s", script, args);

            var tpl = `
(function javascript () {
    var log = console.log;
    var ipc = __graviton__.ipc;
    console.log = function() {
        ipc.send('${prefix}js:log', Array.prototype.slice.call(arguments).map(String));
    };
    try {
        var response = (${script})(${args});
        ipc.send('${prefix}js:response', response);
    } catch (e) {
        ipc.send('${prefix}js:error', e.message, e.name, e.stack);
    }
    console.log = log;
})()`;

            var unbindEvents = () => {
                ipcMain.removeAllListeners(prefix + 'js:response');
                ipcMain.removeAllListeners(prefix + 'js:error');
                ipcMain.removeAllListeners(prefix + 'js:log');
            };


            ipcMain.on(prefix + 'js:response', (event, arg) => {
                debug("receive evaluate js result %s", arg);

                unbindEvents();
                resolve(arg);
            });
            ipcMain.on(prefix + 'js:error', (event, message, name, stack) => {
                debug("failed evaluate js %s", script, message, name, stack);

                unbindEvents();
                var err = new Error(message);
                err.name = name;
                err.stack = stack;

                reject(new JsError(err));
            });
            ipcMain.on(prefix + 'js:log', (event, arg) => {
                debug("jslog %s", arg);
            });

            self.win.webContents.executeJavaScript(tpl);
        });
    }

    /**
     * Waiting various event
     * wait() - alias for wait("event:all")
     * wait("event:dom") - wait until fired dom-ready event
     * wait("event:loaded") - wait until fired did-finish-load event
     * wait("event:all") - temporary alias for wait("event:loaded") (need implement: waiting asyn requests like xhr)
     * wait(function(){return true|false}) - waiting until callback return true
     * wait("dom selectr") - waiting until element added to DOM
     * wait(3000) - simple setTimeout
     * @returns {*}
     */
    wait() {
        var self = this;
        var start = Date.now();
        var args = Array.prototype.slice.call(arguments);

        if (typeof args[0] == "number") {
            return new Promise((resolve)=> {
                setTimeout(()=> {
                    resolve();
                }, args[0]);
            });
        } else if (typeof args[0] == "function") {
            return new Promise((resolve, reject)=> {
                var tm = setTimeout(function retry() {
                    if (Date.now() - start > Graviton.defaults.waitTimeout) {
                        return reject(new GravitonError("wait rejected after global timeout"))
                    }
                    self.evaluate
                        .apply(self, args)
                        .then((result)=> {
                            if (result) {
                                resolve();
                            } else {
                                tm = setTimeout(retry, Graviton.defaults.waitFnTickTime);
                            }
                        })
                        .catch((err)=> {
                            reject(err)
                        });
                }, Graviton.defaults.waitFnTickTime);
            });
        } else if (args[0] == undefined || ~["event:dom", "event:loaded", "event:all"].indexOf(args[0])) {
            var type = args[0] != undefined ? args[0].replace("event:", "") : "all";

            return this.wait(200).then(()=> {
                return new Promise((resolve, reject)=> {
                    var tm = null;

                    tm = setInterval(()=> {
                        if (Date.now() - start > Graviton.defaults.waitTimeout) {
                            clearInterval(tm);
                            return reject(new GravitonError("wait rejected after global timeout"))
                        }
                        if (self._lastFatalError != null) {
                            clearInterval(tm);
                            reject(self._lastFatalError);
                        } else if (
                            (type == "dom" && self._isDomReady)
                            ||
                            (type == "all" && self._isFinishLoaded)
                        ) {
                            clearInterval(tm);
                            resolve(self);
                        }

                    }, Graviton.defaults.waitTickTime);
                });
            });
        } else {
            return this.wait(function (selector) {
                return document.querySelector(selector) ? true : false;
            }, jsesc(args[0]));
        }
    }

    /**
     * Replace browser useragent
     * @param agent
     * @returns {*}
     */
    useragent(agent) {
        if (agent == undefined) {
            return this.win.webContents.getUserAgent();
        }

        this.win.webContents.setUserAgent(agent);
    }

    /**
     * Capture screenshot of current page
     * @param path
     * @param rect
     * @returns {Promise}
     */
    screenshot(path, rect) {
        var self = this;
        return new Promise((resolve, reject)=> {
            var args = [(img)=> {
                if (typeof path == "string") {
                    var buffer = img.toJpeg(50);
                    debug('.screenshot() captured with length %s', buffer.length);

                    fs.writeFile(path, buffer, (err)=> {
                        if (err != null) return reject(err);

                        resolve(self);
                    });
                } else {
                    resolve(img);
                }
            }];
            if (rect) args.unshift(rect);
            self.win.capturePage.apply(self.win, args);
        });
    }

    /**
     * Type words into input, with imitation type on a keyboard
     * @param selector - input DOM selector
     * @param value - words
     * @param delay - delay between type char. Default 100ms
     * @returns {Promise}
     */
    type(selector, value, delay) {
        var self = this;
        delay = delay != undefined ? delay : 100;

        return new Promise((resolve, reject)=> {
            self.evaluate((selector)=> {
                    document.querySelector(selector).focus();
                }, selector)
                .then(()=> {
                    console.log("TRY TO TYPE");
                    var chars = String(value).split('');

                    function type() {
                        var ch = chars.shift();
                        if (ch === undefined) {
                            resolve(self);
                            return;
                        }

                        // keydown
                        self.win.webContents.sendInputEvent({
                            type: 'keyDown',
                            keyCode: ch
                        });

                        // keypress
                        self.win.webContents.sendInputEvent({
                            type: 'char',
                            keyCode: ch
                        });

                        // keyup
                        self.win.webContents.sendInputEvent({
                            type: 'keyUp',
                            keyCode: ch
                        });

                        setTimeout(type, delay);
                    }

                    // start
                    type();
                })
                .catch(reject);
        });
    }

    /**
     * Clicked element on page
     * @param selector
     * @returns {Promise}
     */
    click(selector) {
        return this.evaluate((selector)=> {
            var el = document.querySelector(selector);
            if (el && el.click) el.click();
        }, selector);
    }

    /**
     * Return current page content
     * @returns {Promise}
     */
    content() {
        return this.evaluate(()=> {
            return document.documentElement.outerHTML;
        });
    }

    /**
     * Return current url
     * @returns {*}
     */
    url() {
        return this.win.webContents.getUrl();
    }

    /**
     * Destroy browser
     * @returns {Promise}
     */
    end() {
        var self = this;
        return new Promise((resolve, reject)=> {
            self.win.once('closed', function () {
                resolve();
            });
            self.win.destroy();
        })
    }
}

Graviton.defaults = {
    waitTickTime: 100,
    waitDelayTime: 200,
    waitFnTickTime: 250,
    waitTimeout: 5000,
    electron: {
        show: false,
        webPreferences: {
            nodeIntegration: false,
        }
    },
    headers: {},
};
Graviton.electron = electron;
Graviton.errors = {
    JsError: JsError
};

module.exports = Graviton;