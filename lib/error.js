'use strict';
var ExtendableError = require('es6-error');

class JsError extends ExtendableError {
    constructor(message) {
        if (typeof message == "object") {
            super(message.message);
            this.original = message;
        } else {
            super(message);
        }
    }
}

class ElectronError extends ExtendableError {
    constructor(message, code, desc) {
        super(message);
        this.code = code;
        this.desc = desc;
    }
}

class GravitonError extends ExtendableError {
    constructor(message) {
        super(message);
    }
}


module.exports = {
    ElectronError: ElectronError,
    GravitonError: GravitonError,
    JsError: JsError,
};