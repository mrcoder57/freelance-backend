import mongoose, { Schema, Document, Types } from "mongoose";

export enum ProposalType {
  FIXED = "fixed",
  MILESTONES = "milestones",
}

export interface IProposal extends Document {
  jobId: Types.ObjectId;
  freelancerId: Types.ObjectId;
  clientId: Types.ObjectId;
  coverLetter: string;
  estimatedTime: string;
  proposalType: ProposalType;
  milestones?: {
    description: string;
    dueDate: Date;
    price: number;
    status: "pending" | "completed" | "cancelled";
  }[];
  totalPrice: number;
  status:
    | "pending"
    | "viewed"
    | "accepted"
    | "rejected"
    | "completed"
    | "withdrawn";
  createdAt: Date;
  updatedAt: Date;
  files: string[];
}

const ProposalSchema = new Schema<IProposal>(
  {
    jobId: { type: Schema.Types.ObjectId, ref: "Job", required: true },
    freelancerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    coverLetter: { type: String, required: true },
    estimatedTime: { type: String, required: true },
    files: { type: [String], default: [] },
    proposalType: {
      type: String,
      enum: Object.values(ProposalType),
      required: true,
    },
    milestones: [
      {
        description: { type: String, required: true },
        dueDate: { type: Date, required: true },
        price: { type: Number, required: true },
        status: {
          type: String,
          enum: ["pending", "completed", "cancelled"],
          default: "pending",
        },
      },
    ],
    totalPrice: { type: Number, required: true },
    status: {
      type: String,
      enum: [
        "pending",
        "viewed",
        "accepted",
        "rejected",
        "completed",
        "withdrawn",
      ],
      default: "pending",
    },
  },
  { timestamps: true }
);

export const Proposal = mongoose.model<IProposal>("Proposal", ProposalSchema);
