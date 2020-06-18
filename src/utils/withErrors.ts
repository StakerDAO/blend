function withErrors(command: Function) {
    return async (...args: any[]) => {
        try {
            await command(...args)
            process.exit(0)
        } catch(e) {
            console.error(e)
            process.exit(1)
        }
    }
}

export default withErrors
