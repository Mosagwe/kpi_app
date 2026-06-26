import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";

const usersCollectionName = "users";
const jwtSecret = process.env.JWT_SECRET || "kpi-development-secret-change-me";

export function cleanUsername(value) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40)
    : "";
}

export function cleanName(value) {
  return typeof value === "string"
    ? value.trim().replace(/[^a-zA-Z '-]/g, "").slice(0, 60)
    : "";
}

export function validPassword(password) {
  return password.length >= 8 && password.length <= 50 && /[A-Z]/.test(password) && /[a-z]/.test(password);
}

export function publicUser({ _id, passwordHash, ...user }) {
  return { id: _id.toString(), ...user };
}

export function signToken(user) {
  return jwt.sign(
    { id: user._id.toString(), username: user.username, role: user.role },
    jwtSecret,
    { expiresIn: "8h" }
  );
}

export async function initializeAuth(db) {
  const users = db.collection(usersCollectionName);
  await users.createIndex({ username: 1 }, { unique: true });
  const admin = await users.findOne({ username: "admin" });
  if (!admin) {
    await users.insertOne({
      username: "admin",
      firstName: "Admin",
      lastName: "User",
      passwordHash: await bcrypt.hash("admin", 12),
      role: "admin",
      active: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  } else {
    await users.updateOne(
      { _id: admin._id },
      { $set: { role: "admin", active: admin.active !== false, updatedAt: new Date() } }
    );
  }
  await users.updateMany({ active: { $exists: false } }, { $set: { active: true } });
}

export function authRoutes(db) {
  const createEditorUser = async (payload) => {
    const username = cleanUsername(payload.username);
    const firstName = cleanName(payload.firstName);
    const lastName = cleanName(payload.lastName);
    const password = String(payload.password || "");
    const confirmPassword = String(payload.confirmPassword || payload.password || "");
    if (username.length < 3 || !firstName || !lastName || !validPassword(password) || password !== confirmPassword) {
      return {
        error: "Enter first name, last name, a 3+ character username, matching passwords, and a password of 8-50 characters with upper- and lower-case letters."
      };
    }
    return {
      user: {
        username,
        firstName,
        lastName,
        passwordHash: await bcrypt.hash(password, 12),
        role: "editor",
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };
  };

  return {
    register: async (req, res, next) => {
      try {
        const { user, error } = await createEditorUser(req.body);
        if (error) return res.status(400).json({ error });
        const result = await db.collection(usersCollectionName).insertOne(user);
        const saved = { ...user, _id: result.insertedId };
        res.status(201).json({
          message: "Your account has been created successfully. Proceed to login page to login.",
          user: publicUser(saved)
        });
      } catch (error) {
        if (error?.code === 11000) return res.status(409).json({ error: "That username is already in use." });
        next(error);
      }
    },
    login: async (req, res, next) => {
      try {
        const user = await db.collection(usersCollectionName).findOne({
          username: cleanUsername(req.body.username),
          deletedAt: { $exists: false }
        });
        if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.passwordHash))) {
          return res.status(401).json({ error: "Invalid username or password." });
        }
        if (user.active === false) return res.status(403).json({ error: "This user account is deactivated. Contact the system admin." });
        res.json({ token: signToken(user), user: publicUser(user) });
      } catch (error) {
        next(error);
      }
    },
    me: (req, res) => res.json(publicUser(req.user)),
    profile: async (req, res, next) => {
      try {
        const firstName = cleanName(req.body.firstName);
        const lastName = cleanName(req.body.lastName);
        if (!firstName || !lastName) return res.status(400).json({ error: "First name and last name are required." });
        const user = await db.collection(usersCollectionName).findOneAndUpdate(
          { _id: req.user._id },
          { $set: { firstName, lastName, updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        res.json(publicUser(user));
      } catch (error) {
        next(error);
      }
    },
    password: async (req, res, next) => {
      try {
        const currentPassword = String(req.body.currentPassword || "");
        const newPassword = String(req.body.newPassword || "");
        if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
          return res.status(400).json({ error: "Your current password is incorrect." });
        }
        if (!validPassword(newPassword)) {
          return res.status(400).json({ error: "Use 8-50 characters with at least one upper-case and one lower-case letter." });
        }
        await db.collection(usersCollectionName).updateOne(
          { _id: req.user._id },
          { $set: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date(), updatedAt: new Date() } }
        );
        res.json({ message: "Password changed successfully." });
      } catch (error) {
        next(error);
      }
    },
    users: async (_req, res, next) => {
      try {
        const users = await db.collection(usersCollectionName)
          .find({ deletedAt: { $exists: false } }, { projection: { passwordHash: 0 } })
          .sort({ username: 1 })
          .toArray();
        res.json(users.map(publicUser));
      } catch (error) {
        next(error);
      }
    },
    setRole: async (req, res, next) => {
      try {
        if (!ObjectId.isValid(req.params.id) || !["admin", "editor", "viewer"].includes(req.body.role)) {
          return res.status(400).json({ error: "Invalid user or role." });
        }
        const user = await db.collection(usersCollectionName).findOneAndUpdate(
          { _id: new ObjectId(req.params.id), deletedAt: { $exists: false } },
          { $set: { role: req.body.role, updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        if (!user) return res.status(404).json({ error: "User not found." });
        res.json(publicUser(user));
      } catch (error) {
        next(error);
      }
    },
    createUser: async (req, res, next) => {
      try {
        const { user, error } = await createEditorUser(req.body);
        if (error) return res.status(400).json({ error });
        const result = await db.collection(usersCollectionName).insertOne({
          ...user,
          createdBy: req.user.username
        });
        res.status(201).json(publicUser({ ...user, _id: result.insertedId, createdBy: req.user.username }));
      } catch (error) {
        if (error?.code === 11000) return res.status(409).json({ error: "That username is already in use." });
        next(error);
      }
    },
    setActive: async (req, res, next) => {
      try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid user." });
        const active = Boolean(req.body.active);
        const user = await db.collection(usersCollectionName).findOneAndUpdate(
          { _id: new ObjectId(req.params.id), deletedAt: { $exists: false } },
          { $set: { active, updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        if (!user) return res.status(404).json({ error: "User not found." });
        res.json(publicUser(user));
      } catch (error) {
        next(error);
      }
    },
    softDelete: async (req, res, next) => {
      try {
        if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Invalid user." });
        if (req.params.id === req.user._id.toString()) return res.status(400).json({ error: "You cannot delete your own account." });
        const user = await db.collection(usersCollectionName).findOneAndUpdate(
          { _id: new ObjectId(req.params.id), deletedAt: { $exists: false } },
          { $set: { active: false, deletedAt: new Date(), deletedBy: req.user.username, updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        if (!user) return res.status(404).json({ error: "User not found." });
        res.json({ message: "User deleted successfully." });
      } catch (error) {
        next(error);
      }
    },
    resetPassword: async (req, res, next) => {
      try {
        const newPassword = String(req.body.newPassword || "");
        if (!ObjectId.isValid(req.params.id) || !validPassword(newPassword)) {
          return res.status(400).json({ error: "Use a valid user and an 8-50 character password with upper- and lower-case letters." });
        }
        const user = await db.collection(usersCollectionName).findOneAndUpdate(
          { _id: new ObjectId(req.params.id), deletedAt: { $exists: false } },
          { $set: { passwordHash: await bcrypt.hash(newPassword, 12), passwordChangedAt: new Date(), updatedAt: new Date() } },
          { returnDocument: "after" }
        );
        if (!user) return res.status(404).json({ error: "User not found." });
        res.json(publicUser(user));
      } catch (error) {
        next(error);
      }
    }
  };
}

export function requireAuth(db) {
  return async (req, res, next) => {
    try {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token) return res.status(401).json({ error: "Authentication is required." });
      const payload = jwt.verify(token, jwtSecret);
      const user = await db.collection(usersCollectionName).findOne({ _id: new ObjectId(payload.id), deletedAt: { $exists: false } });
      if (!user) return res.status(401).json({ error: "User account no longer exists." });
      if (user.active === false) return res.status(403).json({ error: "This user account is deactivated. Contact the system admin." });
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
    }
  };
}

export function requireAdmin(req, res, next) {
  return req.user?.role === "admin"
    ? next()
    : res.status(403).json({ error: "Administrator access is required." });
}
