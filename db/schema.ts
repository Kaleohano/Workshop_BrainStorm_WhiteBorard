import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const boardState = sqliteTable("board_state", {
  id: text("id").primaryKey(),
  payload: text("payload").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
