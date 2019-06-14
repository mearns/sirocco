class CallerError extends Error {
    constructor(message) {
        super(message);
        this.name = "CallerError";
        Error.captureStackTrace(this, this.constructor);
    }
}

class ConfigError extends CallerError {
    constructor(message) {
        super(message);
        this.name = "ConfigError";
        Error.captureStackTrace(this, this.constructor);
    }
}

module.exports = { CallerError, ConfigError };
