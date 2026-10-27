import { setServers } from "node:dns";
import { MongoClient } from "mongodb";
const cache = globalThis as typeof globalThis & { __ringBuilderMongo?: Promise<MongoClient> };
export const mongoClient = () => {
  if (!cache.__ringBuilderMongo) {
    if (!process.env.MONGODB_URI) throw new Error("DatabaseNotConfigured");
    if (process.env.MONGODB_DNS_SERVERS) setServers(process.env.MONGODB_DNS_SERVERS.split(",").map(value => value.trim()).filter(Boolean));
    const mongo = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3, minPoolSize: 0, maxIdleTimeMS: 60000, serverSelectionTimeoutMS: 8000, connectTimeoutMS: 8000, socketTimeoutMS: 12000 });
    cache.__ringBuilderMongo = mongo.connect().catch(async error => { cache.__ringBuilderMongo = undefined; await mongo.close(); throw error; });
  }
  return cache.__ringBuilderMongo;
};
export const database = async () => (await mongoClient()).db(process.env.MONGODB_DB || undefined);
