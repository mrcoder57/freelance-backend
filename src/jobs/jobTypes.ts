import { z } from "zod";

const jobSchema = z.object({
  jobTitle: z.string().min(3),
  description: z.string().min(10),
  skills: z.array(z.string()),
  timeline: z.enum(["small", "medium", "large"]),
  totalTime: z.enum(["1 month", "3 months", "6monthsormore"]),
  expertiseLevel: z.enum(["entry", "intermediate", "expert"]),
  paymentType: z.enum(["fixed", "hourly"]),
  price: z.number().optional(),
  fixedPaymentType: z.enum(["milestone", "project"]).optional(),
  pricePerHour: z.object({ min: z.number(), max: z.number() }).optional(),
  files: z.array(z.string()).optional(),
  location: z.string().optional(),
  milestones: z
    .array(
      z.object({
        description: z.string().min(10),
        dueDate: z.string(),
        price: z.number(),
        status: z
          .enum(["pending", "completed", "cancelled"])
          .default("pending"),
      })
    )
    .optional(),
});

export default jobSchema;
