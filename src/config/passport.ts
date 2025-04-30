import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { db } from '../db';
import { Users } from '../db/schema';
import { eq } from 'drizzle-orm';

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID as string,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/user/auth/google/callback',
    scope: ['profile', 'email']
}, async (accessToken, refreshToken, profile, done) => {
    try {
        // Check if user already exists with this Google ID
        const existingUser = await db.select().from(Users).where(eq(Users.googleId, profile.id));
        
        if (existingUser.length > 0) {
            // User already exists
            return done(null, existingUser[0]);
        }
        
        // Check if user exists with the same email
        const userWithEmail = await db.select().from(Users).where(eq(Users.email, profile.emails?.[0].value || ''));
        
        if (userWithEmail.length > 0) {
            // Update existing user with Google ID
            const updatedUser = await db.update(Users)
                .set({ googleId: profile.id })
                .where(eq(Users.id, userWithEmail[0].id))
                .returning();
            
            return done(null, updatedUser[0]);
        }
        
        // Create new user
        const newUser = await db.insert(Users).values({
            name: profile.displayName,
            email: profile.emails?.[0].value || '',
            googleId: profile.id
        }).returning();
        
        return done(null, newUser[0]);
    } catch (error) {
        return done(error as Error);
    }
}));

// Serialization and deserialization for session management
passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: number, done) => {
    try {
        const user = await db.select().from(Users).where(eq(Users.id, id));
        done(null, user[0] || null);
    } catch (error) {
        done(error, null);
    }
});

export default passport; 