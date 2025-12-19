import * as z from 'zod';
import {
    GitHubProfileSchema,
    type GitHubProfile,
    ImageRefSchema,
    type ImageRef,
} from '@happy/protocol';

// Re-export for local use
export { GitHubProfileSchema, ImageRefSchema };
export type { GitHubProfile, ImageRef };

//
// Schema
//

export const ProfileSchema = z.object({
    id: z.string(),
    timestamp: z.number(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    avatar: ImageRefSchema.nullable().optional(), // Server may not return avatar field
    github: GitHubProfileSchema.nullable().optional(), // Server may not return github field
    connectedServices: z.array(z.string()).default([])
});

export type Profile = z.infer<typeof ProfileSchema>;

//
// Defaults
//

export const profileDefaults: Profile = {
    id: '',
    timestamp: 0,
    firstName: null,
    lastName: null,
    avatar: null,
    github: null,
    connectedServices: []
};
Object.freeze(profileDefaults);

//
// Parsing
//

export function profileParse(profile: unknown): Profile {
    const parsed = ProfileSchema.safeParse(profile);
    if (!parsed.success) {
        console.error('Failed to parse profile:', parsed.error);
        return { ...profileDefaults };
    }
    return parsed.data;
}

//
// Utility functions
//

export function getDisplayName(profile: Profile): string | null {
    if (profile.firstName || profile.lastName) {
        return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
    }
    if (profile.github?.name) {
        return profile.github.name;
    }
    if (profile.github?.login) {
        return profile.github.login;
    }
    return null;
}

export function getAvatarUrl(profile: Profile): string | null {
    if (profile.avatar?.url) {
        return profile.avatar.url;
    }
    if (profile.github?.avatar_url) {
        return profile.github.avatar_url;
    }
    return null;
}

export function getBio(profile: Profile): string | null {
    return profile.github?.bio || null;
}