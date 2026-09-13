import { expect, test } from "bun:test";
import { generationRetrieval } from "./bench-mode";

test("base mode keeps metric index out of generation and does not create an embedder", () => {
  let created = 0;

  const result = generationRetrieval("base", { docs: [] }, () => {
    created += 1;
    return async () => [];
  });

  expect(result).toEqual({});
  expect(created).toBe(0);
});

test.each(["rag", "lora"])("%s mode injects retrieval dependencies", (mode) => {
  const index = { docs: [] };
  const embed = async () => [];

  expect(generationRetrieval(mode, index, () => embed)).toEqual({ index, embed });
});

