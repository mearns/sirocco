const chalk = require("chalk");

function logNamedValue(name, value, explanation) {
    const explanationString = explanation
        ? ` ${chalk.gray(`(${explanation})`)}`
        : "";
    console.log(
        `${chalk.green(`${name}:`)} ${chalk.yellowBright(
            value
        )}${explanationString}`
    );
}

module.exports = {
    logNamedValue
};
