import { z } from 'zod';

export const locationSearchSchema = z.object({
  features: z.array(z.object({
    geometry: z.object({ coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]) }),
    properties: z.object({ label: z.string().trim().min(3).max(500) }),
  })),
});

export type LocationResult = z.infer<typeof locationSearchSchema>['features'][number];
