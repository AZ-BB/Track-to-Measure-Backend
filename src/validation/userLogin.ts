import { z } from 'zod'
export const UserLoginSchema = z.object({

    email: z.string({
        required_error: "email is required"
    }).email(),

    password: z.string({
        required_error: "password is required"
    }).min(8),

})

export type UserLoginType = z.infer<typeof UserLoginSchema>