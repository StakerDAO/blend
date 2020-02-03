const deploy = require('./commands/deploy')
const info = require('./commands/info')
const merge = require('./commands/merge')
const sign = require('./commands/sign')
const submit = require('./commands/submit')
const upgrade = require('./commands/upgrade')

module.exports = {
    deploy, info, merge, sign, submit, upgrade
}
