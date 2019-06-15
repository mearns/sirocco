const chalk = require("chalk");
const TimeAgo = require("javascript-time-ago");

// sorry.
TimeAgo.addLocale(require("javascript-time-ago/locale/en"));
const timeAgo = new TimeAgo("en-US");

function logNamedValue(name, value, explanation, indent = "") {
    const explanationString = explanation
        ? ` ${chalk.gray(`(${explanation})`)}`
        : "";
    const valueString = value ? ` ${chalk.cyanBright(value)}` : "";
    console.log(
        `${indent}${chalk.blue(`${name}:`)}${valueString}${explanationString}`
    );
}

function logPastDate(description, d) {
    logNamedValue(description, timeAgo.format(d), d);
}

module.exports = {
    logNamedValue,
    logPastDate
};
