'use strict';
const debug = require('debug')('graviton');
const log = require('debug')('graviton:events');
const fs = require('fs');

const errors = require("./error");

const _ = require("lodash");
const shortid = require('shortid');

const electron = require('electron');
const app = electron.app;  // Module to control application life.
const BrowserWindow = electron.BrowserWindow;
const session = electron.session;
const ipcMain = electron.ipcMain;

var isAppReady = false;
var preload = __dirname + "/preload.js";

const JsError = errors.JsError;
const ElectronError = errors.ElectronError;
const GravitonError = errors.GravitonError;
const ExtendableError = errors.ExtendableError;

const URL = require("url");

const jsesc = require('jsesc');

class Graviton {
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
    }

    goto(url, headers) {
        var self = this;
        return new Promise((resolve, reject)=> {
            debug("goto %s", url);

            self.win.webContents.loadURL(url, {
                extraHeaders: _.defaults(headers, Graviton.defaults.headers)
            });

            self.win.webContents.once('did-finish-load', () => {
                debug("finish load %s", url);
                resolve(self);
            });

            self.win.webContents.once('did-fail-load', (event, code, desc) => {
                reject(new ElectronError("failed to load page", code, desc));
            });
        });
    }

    evaluate(js) {
        var self = this;
        return new Promise((resolve, reject) => {
            var script = String(js);
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
                debug("failed evaluate js %s", script);

                unbindEvents();
                reject(new JsError(ExtendableError.factory(message, name, stack)));
            });
            ipcMain.on(prefix + 'js:log', (event, arg) => {
                debug("jslog %s", arg);
            });

            self.win.webContents.executeJavaScript(tpl);
        });
    }

    // type can be dom|all
    // wait() - короткий вариант wait("event:all")
    // wait("event:dom") - ждёт когда загрузится window.DOMContentLoaded
    // wait("event:loaded") - ждёт события window.onload
    // wait("event:all") - ждёт все события (не реализованн: + ждёт окончание асинхронных загрузок)
    // wait("#test") - ждёт элемент на странице
    // wait(function(){return true|false}) - ждём когда функция вернёт true, выполняется в контексте страницы
    //
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
                    if (Date.now() - start > Graviton.defaults.waitGlobalTimeout) {
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
                        if (Date.now() - start > Graviton.defaults.waitGlobalTimeout) {
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

    useragent(agent) {
        if (agent == undefined) {
            return this.win.webContents.getUserAgent();
        }

        this.win.webContents.setUserAgent(agent);
    }

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

    content() {
        return this.evaluate(()=> {
            return document.documentElement.outerHTML;
        });
    }

    url() {
        return this.win.webContents.getUrl();
    }

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
    waitGlobalTimeout: 30000,
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