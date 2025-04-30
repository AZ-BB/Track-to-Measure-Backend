import CustomError from "./CustomError";

class BadRequest extends CustomError {

    public validation: string[];

    constructor(message: string = '', code: number = 0, validation: string[] = []) {
        super(code, message)
        this.validation = validation;
    }


}

export default BadRequest