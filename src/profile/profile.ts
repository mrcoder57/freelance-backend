import { Hono } from "hono";
import { connectDB } from "../../helper/dbConnect";
import redis from "../../helper/redisClient";
import {
  profileSchema,
  portfolioSchema,
  educationSchema,
  experienceSchema,
  universalValidation,
} from "./profileTypes";
import Profile from "../../models/profile/profileModel";
import { verifyToken } from "../../helper/JwtHelpers/verifyToken";
import User from "../../models/user/userModel";
import { ProposalRefreshTracker } from "../../models/monthlyProposalUpdate/monthlyProposalUpdateModel";
import { ProposalAccount } from "../../models/proposals/account/accountModel";

const profile = new Hono();

// ✅ POST API: Create Profile & Initialize ProposalAccount
profile.post("/profile", universalValidation(profileSchema), async (c) => {
  try {
    const {
      jobTitle,
      profileDescription,
      cityName,
      address,
      country,
      hourlyRate,
      skills,
      zipcode,
    } = await c.req.json();

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, { status: 401 });
    }

    // Extract and verify token
    const token = authHeader.split(" ")[1];
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, { status: 401 });
    }

    const { id: userId } = tokenVerification.decoded!;
    const user = await User.findById(userId);
    if (!user) {
      return c.json({ error: "User not found" }, { status: 404 });
    }

    const { firstName, lastName, userType } = user;

    // ✅ Ensure user is a freelancer (since only freelancers need proposal tracking)
    if (userType !== "freelancer") {
      return c.json({ error: "Only freelancers can create a profile" }, { status: 403 });
    }

    // Check if profile already exists
    const existingProfile = await Profile.findOne({ userId });
    if (existingProfile) {
      return c.json({ error: "Profile already exists for this user" }, { status: 400 });
    }

    // ✅ Fetch the current month's proposal refresh count
    const currentDate = new Date();
    const month = currentDate.toLocaleString("en-US", { month: "short" }); // e.g., "Jan"
    const year = currentDate.getFullYear();

    const currentTracker = await ProposalRefreshTracker.findOne({
      "monthDetails.month": month,
      "monthDetails.year": year,
    });
    //  console.log(currentTracker)
    const proposalsToRefresh = currentTracker?.proposalsToRefresh || 0; // Default to 0 if not found
    // console.log(proposalsToRefresh)
    // ✅ Create a new profile
    const newProfile = new Profile({
      userId,
      jobTitle,
      skills,
      profileDescription,
      cityName,
      address,
      country,
      zipcode,
      hourlyRate,
      firstName,
      lastName,
    });

    await newProfile.save();

    // ✅ Create a ProposalAccount entry for tracking proposals
    const newProposalAccount = new ProposalAccount({
      userId,
      userType: "freelancer",
      proposalCount:proposalsToRefresh,
    });

    await newProposalAccount.save();

    return c.json(
      {
        message: "Profile created successfully",
        profile: newProfile,
        proposalAccount: newProposalAccount,
      },
      { status: 201 }
    );
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
});
// Update Profile
profile.put("/profile", universalValidation(profileSchema), async (c) => {
  try {
    const {
      jobTitle,
      profileDescription,
      cityName,
      address,
      country,
      zipcode,
      firstName,
      lastName,
    } = await c.req.json();

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, 401);
    }

    // Extract token from the header
    const token = authHeader.split(" ")[1];

    // Verify token
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, 401);
    }

    const { id: userId } = tokenVerification.decoded!;

    // Update the profile in the Profile collection
    const updatedProfile = await Profile.findOneAndUpdate(
      { userId },
      {
        jobTitle,
        profileDescription,
        cityName,
        address,
        country,
        zipcode,
        firstName,
        lastName,
      },
      { new: true }
    );
    const cacheKey = `api:profile:${userId}`;
    await redis.del(cacheKey);
    if (!updatedProfile) {
      return c.json({ error: "Profile not found" }, 404);
    }

    // Update the first and last name in the Users collection
    const updatedUser = await User.findOneAndUpdate(
      { _id: userId },
      { firstName, lastName },
      { new: true }
    );

    if (!updatedUser) {
      return c.json({ error: "User not found" }, 404);
    }

    return c.json({
      message: "Profile and user details updated successfully",
      profile: updatedProfile,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      400
    );
  }
});
// get all profiles
profile.get("/profiles", async (c) => {
  try {
    const cacheKey = "api:profiles"; // Unique cache key

    // Check if response is cached
    const cachedData = await redis.get(cacheKey);
    if (cachedData) {
      return c.json({ source: "cache", data: cachedData });
    }
    // Fetch all profiles
    const profiles = await Profile.find();

    if (!profiles || profiles.length === 0) {
      return c.json({ error: "No profiles found" }, 404);
    }
    // Cache the profiles with an updated expiration time (e.g., 300 seconds)
    await redis.set(cacheKey, JSON.stringify(profiles), { ex: 1000 });

    return c.json({
      message: "Profiles fetched successfully",
      profiles,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      400
    );
  }
});
//get user profile
// ✅ GET API: Fetch Profile (+ ProposalAccount if Owner)
profile.get("/profile/:userId", async (c) => {
  try {
    const { userId } = c.req.param();

    // Define a unique cache key for the user's profile
    const cacheKey = `api:profile:${userId}`;

    // Check if the profile data is cached
    const cachedProfile = await redis.get(cacheKey);
    if (cachedProfile) {
      return c.json({ source: "cache", data: cachedProfile });
    }

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, { status: 401 });
    }

    // Extract token from the header & verify
    const token = authHeader.split(" ")[1];
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, { status: 401 });
    }

    const { id: currentUserId } = tokenVerification.decoded!;

    // Fetch the profile for the specific user
    const userProfile = await Profile.findOne({ userId });

    if (!userProfile) {
      return c.json({ error: "Profile not found" }, { status: 404 });
    }

    // Check if the current user is the owner of the profile
    const isOwner = userProfile.userId.toString() === currentUserId;

    let proposalAccount = null;

    // ✅ If the user is the owner, fetch ProposalAccount
    if (isOwner) {
      proposalAccount = await ProposalAccount.findOne({ userId });
    }

    // Prepare the profile data
    const profileData = {
      ...userProfile.toObject(),
      isOwner,
      proposalAccount, // Include only if owner
    };

    // Cache the profile data for 300 seconds
    await redis.set(cacheKey, JSON.stringify(profileData), { ex: 300 });

    return c.json({
      message: "Profile fetched successfully",
      profile: profileData,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      { status: 400 }
    );
  }
});


// Create Portfolio
profile.post(
  "/profile/portfolio",
  universalValidation(portfolioSchema),
  async (c) => {
    try {
      const { image, projectLink } = await c.req.json();

      // Get the token from the Authorization header
      const authHeader = c.req.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Authorization token is required" }, 401);
      }

      // Extract token from the header
      const token = authHeader.split(" ")[1];

      // Verify token
      const tokenVerification = await verifyToken(token);
      if (tokenVerification.error) {
        return c.json({ error: tokenVerification.error }, 401);
      }

      const { id: userId } = tokenVerification.decoded!;

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId },
        { $push: { portfolio: { image, projectLink } } },
        { new: true }
      );

      if (!updatedProfile) {
        return c.json({ error: "Profile not found" }, 404);
      }

      return c.json({
        message: "Portfolio added successfully",
        profile: updatedProfile,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400
      );
    }
  }
);

// Edit Portfolio
profile.put(
  "/profile/portfolio/:id",
  universalValidation(portfolioSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { image, projectLink } = await c.req.json();

      // Get the token from the Authorization header
      const authHeader = c.req.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Authorization token is required" }, 401);
      }

      // Extract token from the header
      const token = authHeader.split(" ")[1];

      // Verify token
      const tokenVerification = await verifyToken(token);
      if (tokenVerification.error) {
        return c.json({ error: tokenVerification.error }, 401);
      }

      const { id: userId } = tokenVerification.decoded!;

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId, "portfolio._id": id },
        {
          $set: {
            "portfolio.$.image": image,
            "portfolio.$.projectLink": projectLink,
          },
        },
        { new: true }
      );

      if (!updatedProfile) {
        return c.json({ error: "Portfolio item not found" }, 404);
      }

      return c.json({
        message: "Portfolio updated successfully",
        profile: updatedProfile,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400
      );
    }
  }
);

// Delete Portfolio
profile.delete("/profile/portfolio/:id", async (c) => {
  try {
    const { id } = c.req.param();

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, 401);
    }

    // Extract token from the header
    const token = authHeader.split(" ")[1];

    // Verify token
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, 401);
    }

    const { id: userId } = tokenVerification.decoded!;

    const updatedProfile = await Profile.findOneAndUpdate(
      { userId },
      { $pull: { portfolio: { _id: id } } },
      { new: true }
    );

    if (!updatedProfile) {
      return c.json({ error: "Portfolio item not found" }, 404);
    }

    return c.json({
      message: "Portfolio item deleted successfully",
      profile: updatedProfile,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      400
    );
  }
});

// Edit Education
profile.put(
  "/profile/education/:id",
  universalValidation(educationSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { institution, degree, fieldOfStudy, graduationYear } =
        await c.req.json();

      // Get the token from the Authorization header
      const authHeader = c.req.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Authorization token is required" }, 401);
      }

      // Extract token from the header
      const token = authHeader.split(" ")[1];

      // Verify token
      const tokenVerification = await verifyToken(token);
      if (tokenVerification.error) {
        return c.json({ error: tokenVerification.error }, 401);
      }

      const { id: userId } = tokenVerification.decoded!;

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId, "education._id": id },
        {
          $set: {
            "education.$.institution": institution,
            "education.$.degree": degree,
            "education.$.fieldOfStudy": fieldOfStudy,
            "education.$.graduationYear": graduationYear,
          },
        },
        { new: true }
      );

      if (!updatedProfile) {
        return c.json({ error: "Education entry not found" }, 404);
      }

      return c.json({
        message: "Education updated successfully",
        profile: updatedProfile,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400
      );
    }
  }
);

// Delete Education
profile.delete("/profile/education/:id", async (c) => {
  try {
    const { id } = c.req.param();

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, 401);
    }

    // Extract token from the header
    const token = authHeader.split(" ")[1];

    // Verify token
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, 401);
    }

    const { id: userId } = tokenVerification.decoded!;

    const updatedProfile = await Profile.findOneAndUpdate(
      { userId },
      { $pull: { education: { _id: id } } },
      { new: true }
    );

    if (!updatedProfile) {
      return c.json({ error: "Education entry not found" }, 404);
    }

    return c.json({
      message: "Education entry deleted successfully",
      profile: updatedProfile,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      400
    );
  }
});

// Edit Experience
profile.put(
  "/profile/experience/:id",
  universalValidation(experienceSchema),
  async (c) => {
    try {
      const { id } = c.req.param();
      const { companyName, position, startDate, endDate, description } =
        await c.req.json();

      // Get the token from the Authorization header
      const authHeader = c.req.header("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return c.json({ error: "Authorization token is required" }, 401);
      }

      // Extract token from the header
      const token = authHeader.split(" ")[1];

      // Verify token
      const tokenVerification = await verifyToken(token);
      if (tokenVerification.error) {
        return c.json({ error: tokenVerification.error }, 401);
      }

      const { id: userId } = tokenVerification.decoded!;

      const updatedProfile = await Profile.findOneAndUpdate(
        { userId, "experience._id": id },
        {
          $set: {
            "experience.$.companyName": companyName,
            "experience.$.position": position,
            "experience.$.startDate": startDate,
            "experience.$.endDate": endDate,
            "experience.$.description": description,
          },
        },
        { new: true }
      );

      if (!updatedProfile) {
        return c.json({ error: "Experience entry not found" }, 404);
      }

      return c.json({
        message: "Experience updated successfully",
        profile: updatedProfile,
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Invalid request" },
        400
      );
    }
  }
);

// Delete Experience
profile.delete("/profile/experience/:id", async (c) => {
  try {
    const { id } = c.req.param();

    // Get the token from the Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Authorization token is required" }, 401);
    }

    // Extract token from the header
    const token = authHeader.split(" ")[1];

    // Verify token
    const tokenVerification = await verifyToken(token);
    if (tokenVerification.error) {
      return c.json({ error: tokenVerification.error }, 401);
    }

    const { id: userId } = tokenVerification.decoded!;

    const updatedProfile = await Profile.findOneAndUpdate(
      { userId },
      { $pull: { experience: { _id: id } } },
      { new: true }
    );

    if (!updatedProfile) {
      return c.json({ error: "Experience entry not found" }, 404);
    }

    return c.json({
      message: "Experience entry deleted successfully",
      profile: updatedProfile,
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : "Invalid request" },
      400
    );
  }
});

export default profile;
