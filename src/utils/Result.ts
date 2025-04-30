interface IResult {
    data?: any,
    message?: string,
    status: boolean,
    responseDate: Date,
    handler?: string,
    validation?: string[],
    meta?: any
}

export class Result implements IResult {

    data?: any;
    message?: string;
    status: boolean;
    responseDate: Date;
    handler?: string;
    validation?: string[];
    meta?: any;

    constructor({
        status, message, data, handler, validation, meta
    }: {
        status: boolean,
        data?: any,
        message?: string,
        handler?: string,
        validation?: string[],
        meta?: any
    }) {
        this.data = data;
        this.message = message;
        this.status = status;
        this.handler = handler;
        this.responseDate = new Date(new Date().getTime());
        this.validation = validation;
        this.meta = meta;
    }

}