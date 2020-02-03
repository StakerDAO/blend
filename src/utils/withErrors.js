function withErrors(command) {
    return async (...args) => {
        try {
            await command(...args)
            process.exit(0)
        } catch(e) {
            console.error(e)
            process.exit(1)
        }
    }
}

module.exports = withErrors
