export type Drill = { id: string; name: string; description: string; maxHits: number; distance?: string; notes?: string; favorite: boolean; active: boolean; createdAt: string; updatedAt: string };
export type Standard = { id: string; name: string; maxTime: number; description?: string; order: number };
export type CourseEntry = { id: string; drillId: string; order: number; standards: Standard[]; notes?: string };
export type Course = { id: string; name: string; description: string; notes?: string; entries: CourseEntry[]; favorite: boolean; active: boolean; createdAt: string; updatedAt: string };
export type Run = { id: string; drillId: string; drillNameAtTime: string; courseId?: string; courseNameAtTime?: string; courseEntryId?: string; timestamp: string; time: number; alpha: number; charlie: number; delta: number; miss: number; points: number; hitFactor: number; achievedStandardId?: string; achievedStandardName?: string; maxHitsAtTime: number };
export type Backup = { version: 1; exportedAt: string; drills: Drill[]; courses: Course[]; runs: Run[]; settings: Record<string, unknown> };
