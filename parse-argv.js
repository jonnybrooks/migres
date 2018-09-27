const filenameRgx = /^[\\\/\w\s\._-]+$/;

// configure the cli commands and options
const commands = ["create", "commit", "rollback"];

let options = {
    "--all": { valid_for: ["commit", "rollback"], default: false },
    "--env": { valid_for: ["commit", "rollback"], expect:  filenameRgx, default: ".env" },
    "--migrations": { valid_for: commands, expect: filenameRgx, default: "postgres_migrations" },
    "--prefix": { valid_for: ["create"], expect: /time/, default: "time" }
};

const aliases = {
    "-a": "--all",
    "-e": "--env",
    "-m": "--migrations",
    "-p": "--prefix"
};

/*
* Initial validation
* */
// quit early if the arguments supplied are insufficient
if(process.argv.length < 3)
    throw new Error(`Incorrect usage of migres. "Expected: ${commands.join("|")} [options]`);

// quit early if the command is invalid
const cmd = process.argv[2];
if(!commands.includes(cmd))
    throw new Error(`Command is invalid. Got: ${cmd} Expected: ${commands.join(", ")}`)

// iterator generator
const iter = (function* () {
    for(const arg of process.argv.slice(3)) {
        yield arg;
    }
})();

/*
* Parse the arguments
* */
while(true) {
    let {value: arg, done} = iter.next();

    // no more args to parse
    if(done) break;

    // argument name (or alias) is invalid
    arg = options[arg] ? arg : aliases[arg];
    if(!options[arg]) {
        const optionKeys = Object.keys(options).join(", ");
        throw new Error(`Argument ${arg} is invalid. Options: ${optionKeys} `)
    }

    // parse boolean flags
    if(!options[arg].expect) {
        options[arg].value = true;
        continue;
    }

    // parse value flags
    const {value} = iter.next();

    // no value provided
    if(!value) {
        throw new Error(`No value provided for arg ${arg} where one was expected`);
    }

    // invalid value provided
    if(!options[arg].expect.test(value)) {
        throw new Error(`Invalid value for argument ${arg}. Got: "${value}", Expected: ${ options[arg].expect }`)
    }

    options[arg].value = value;
}

/*
* Verify mandatory fields are filled and overwrite empty values with defaults
* */
let exported = { cmd };
for(const op in options) {
    // todo: don't continue over mandatory fields (future feature)
    // if(!options[op].value) continue;

    options[op].value = options[op].value || options[op].default;

    // make the keys easier to reference by removing prefixed hyphens
    exported[op.replace(/-/g, "")] = options[op].value;
}

module.exports = exported;