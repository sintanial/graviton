window.__graviton__ = {};
window.__graviton__.ipc = require('electron').ipcRenderer;
//
//(function () {
//    function setNavProp(name, value) {
//        if (Object.defineProperty) {
//            Object.defineProperty(window.navigator, name, {
//                get: function () {
//                    return value
//                }
//            });
//        } else if (Object.prototype.__defineGetter__) {
//            window.navigator.__defineGetter__(name, function () {
//                return value;
//            });
//        }
//    }
//
//    var ipc = require('electron').ipcRenderer;
//    ipc.on('set-navigator', function (event, name, value) {
//        setNavProp(name, value);
//        ipc.send('set-navigator');
//    });
//})();