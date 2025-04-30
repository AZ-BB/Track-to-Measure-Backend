import { eq } from "drizzle-orm";
import { db } from "../db";
import { Users } from "../db/schema";
import BadRequest from "../middlewares/handlers/errors/BadRequest";
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'

async function createUser(user: {
    name: string,
    email: string,
    password: string
}) {
    const result = await db.select().from(Users).where(eq(Users.email, user.email))

    if (result.length > 0) {
        throw new BadRequest("Email already exists");
    }

    const hashedPassword = await bcrypt.hash(user.password, 10)

    const newUser = await db.insert(Users).values({
        name: user.name,
        email: user.email,
        passwordHash: hashedPassword
    }).returning()

    return {
        id: newUser[0].id,
        name: newUser[0].name,
        email: newUser[0].email
    }
}

async function deleteUser(id: number) {
    const user = await db.select().from(Users).where(eq(Users.id, id))

    if (user.length === 0) {
        throw new BadRequest("User not found");
    }
    const result = await db.delete(Users).where(eq(Users.id, id))
    if (result.rowCount === 0) {
        throw new BadRequest("User not found");
    }

    return {
        message: "User deleted successfully"
    }
}

async function login(email: string, password: string) {

    const result = await db.select().from(Users).where(eq(Users.email, email))


    if (result.length === 0) {
        throw new BadRequest("User not found");
    }

    const user = result[0]!

    if (!user.passwordHash) {
        throw new BadRequest("User is not registered with password");
    }

    const comparePassword = await bcrypt.compare(password, user.passwordHash)

    if (!comparePassword) {
        throw new BadRequest("Invalid password");
    }

    const token = jwt.sign({ id: user.id, email: user.email }, process.env.SECRET as string)

    return {
        token,
        id: user.id,
        name: user.name,
        email: user.email
    }

}

async function getUsers() {
    const users = await db.select().from(Users)
    return users
}

async function getUserById(id: number) {
    const user = await db.select().from(Users).where(eq(Users.id, id))

    if (user.length === 0) {
        throw new BadRequest("User not found");
    }

    return user[0]
}

async function updateUser(id: number, updatedUser: {
    name?: string,
    email?: string,
    password?: string
}) {

    const user = await getUserById(id);

    let hashedPassword = user.passwordHash;
    if (updatedUser.password) {
        hashedPassword = await bcrypt.hash(updatedUser.password, 10)
    }

    const result = await db.update(Users).set({
        name: updatedUser.name ?? user.name,
        email: updatedUser.email ?? user.email,
        passwordHash: hashedPassword
    }).where(eq(Users.id, id)).returning()

    return result[0]
}

export const userServices = {
    createUser,
    deleteUser,
    login,
    getUsers,
    getUserById,
    updateUser
}