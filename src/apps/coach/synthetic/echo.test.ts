import { describe, expect, it } from "vitest";

import { parroted } from "./echo";

describe("parroted — the coach saying a learner line as its own", () => {
  it("parroted catches the counterpart saying a learner line and passes a suggestion", () => {
    const p = ["I don't remember the exact details, but I can check and get back to you."];
    expect(parroted("Sure. I don't remember the exact details, but I can check and get back to you.", p)).toEqual(p);
    expect(parroted("Sure. I don’t remember the exact details — but I can check and get back to you!", p)).toEqual(p);
    expect(parroted(`You could say: "I don't remember the exact details, but I can check and get back to you."`, p)).toEqual([]);
    expect(parroted("We review every tool once a year.", p)).toEqual([]);
    expect(parroted("You could charmingly say: I don't remember the exact details, but I can check and get back to you.", p)).toEqual([]);
    const two = ["Most of our tools are low risk.", "I don't remember the exact details."];
    expect(parroted("You could say: Most of our tools are low risk. And honestly, I don't remember the exact details.", two)).toEqual([two[1]]);
    expect(parroted("Interesting. How does your company handle this?", ["How does your company handle this?"])).toEqual([]);
    // A recast of what the learner has just said passes; the same line before they said it does not.
    const line = ["Before, agents spent a lot of time looking for materials."];
    const learner = "Before agents spent a lot of time looking for materials.";
    expect(parroted("Right, before, agents spent a lot of time looking for materials. And now?", line, learner)).toEqual([]);
    expect(parroted("Right, before, agents spent a lot of time looking for materials. And now?", line, "Sure, happy to.")).toEqual(line);
    expect(parroted(`Let's have you repeat that one line: "${line[0]}"`, line)).toEqual([]);
  });

  it("parroted catches the same view in the coach's own frame, and passes a different view", () => {
    const hard = ["For us, the hard part is keeping it up to date."];
    expect(parroted("That matches our experience. For us, the hard part is keeping the risk levels up to date.", hard)).toEqual(hard);
    const human = ["For our agents, the human part of the job matters even more now."];
    expect(parroted("It reminds us that for your agents, the human part of the job matters even more now.", human)).toEqual(human);
    // A view of the coach's own side that shares a word or two stays the coach's.
    expect(parroted("For us, the hard part was getting the business units to agree on the levels.", hard)).toEqual([]);
    expect(parroted("Our agents were worried at first that the tool would replace them.", human)).toEqual([]);
    // "Let's say: …" hands the line over, like "You could say".
    const hide = ["Before anything goes to a cloud model, we hide the personal details."];
    expect(parroted("That is a perfect summary. Let's say: Before anything goes to a cloud model, we hide the personal details.", hide)).toEqual([]);
    expect(parroted("Let’s say: Before anything goes to a cloud model, we hide the personal details.", hide)).toEqual([]);
    expect(parroted("Right. Before anything goes to a cloud model, we hide the personal details.", hide)).toEqual(hide);
    // A line too short to carry a view is matched as the exact words only.
    expect(parroted("Thanks, I see.", ["Thank you."])).toEqual([]);
    expect(parroted("Well, thank you. That was great.", ["Thank you."])).toEqual(["Thank you."]);
  });

});
