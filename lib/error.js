'use strict';
class ExtendableError extends Error {
    static factory(message, name, stack) {
        var err = new Error(message);
        err.name = name;
        err.stack = stack;
        return err;
    }

    constructor(message) {
        super(message);

        // extending Error is weird and does not propagate `message`
        Object.defineProperty(this, 'message', {
            enumerable: false,
            value: message
        });

        Object.defineProperty(this, 'name', {
            enumerable: false,
            value: this.constructor.name,
        });

        if (Error.hasOwnProperty('captureStackTrace')) {
            Error.captureStackTrace(this, this.constructor);
            return;
        }

        Object.defineProperty(this, 'stack', {
            enumerable: false,
            value: (new Error(message)).stack,
        });
    }
}


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
    ExtendableError: ExtendableError,
    ElectronError: ElectronError,
    JsError: JsError,
};