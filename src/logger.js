const chalk = require("chalk");
const TimeAgo = require("javascript-time-ago");

let useJsonLogging = false;

function jsonLogging(_jsonLogging = true) {
    useJsonLogging = _jsonLogging;
}

function getLog() {
    return rootLog;
}

function emit(name, { value, explanation }) {
    if (!useJsonLogging) {
        const explanationString = explanation
            ? ` ${chalk.gray(`(${explanation})`)}`
            : "";
        const valueString = value ? ` ${chalk.cyanBright(value)}` : "";
        const indentLevel = path.length;
        const indent = new Array(indentLevel).fill("    ").join("");
        console.log(
            `${indent}${chalk.blue(
                `${name}:`
            )}${valueString}${explanationString}`
        );
    }
}

function emitClose(empty) {
    if (!useJsonLogging) {
        if (empty) {
            const indentLevel = path.length + 1;
            const indent = new Array(indentLevel).fill("    ").join("");
            console.log(`${indent}${chalk.gray("<none>")}`);
        }
    }
}

const rootLog = {};
const stack = [rootLog];
const path = [];

function logToEnd(name, value, explanation) {
    const currentLog = stack[stack.length - 1];
    const entry = {
        value,
        explanation
    };
    currentLog[name] = entry;
    emit(name, entry);
    return entry;
}

function log(name, value, explanation) {
    logToEnd(name, value, explanation);
}

function open(name, value, explanation) {
    const entry = logToEnd(name, value, explanation);
    entry.nested = {};
    path.push(name);
    stack.push(entry.nested);
}

function close() {
    const empty = Object.entries(stack[stack.length - 1]).length === 0;
    path.pop();
    stack.pop();
    emitClose(empty);
}

// sorry.
TimeAgo.addLocale(require("javascript-time-ago/locale/en"));
const timeAgo = new TimeAgo("en-US");
function logPastDate(description, d) {
    log(description, timeAgo.format(d), d);
}

module.exports = {
    log,
    logPastDate,
    open,
    close,
    jsonLogging,
    getLog
};
