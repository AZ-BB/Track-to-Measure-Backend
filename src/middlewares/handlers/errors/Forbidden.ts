import CustomError from "./CustomError";

class Forbidden extends CustomError {

    constructor(message: string = '', code: number = 403) {
        super(code, message)
    }

}

export default Forbidden