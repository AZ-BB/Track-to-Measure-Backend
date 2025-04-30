import { z } from 'zod'
export const UserCreateSchema = z.object({

    name: z.string({
        required_error: "name is required"
    }).min(3),

    email: z.string({
        required_error: "email is required"
    }).email(),

    password: z.string({
        required_error: "password is required"
    }).min(8),

})

export type UserCreateType = z.infer<typeof UserCreateSchema>