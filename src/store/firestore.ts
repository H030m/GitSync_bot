import { Firestore } from "@google-cloud/firestore";
import { config } from "../config";

const firestoreOptions: Record<string, unknown> = {};
if (config.firestore.projectId) firestoreOptions.projectId = config.firestore.projectId;
if (config.firestore.keyFilename) firestoreOptions.keyFilename = config.firestore.keyFilename;

export const db = new Firestore(firestoreOptions);
