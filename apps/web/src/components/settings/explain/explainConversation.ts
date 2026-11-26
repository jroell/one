import { explainTopic } from "./explainTopics";
import type { ExplainTopicId, SetupSnapshot } from "./explainTypes";

const OTHER_MACHINE_LINE =
  "The person was looking at Settings for another machine. These facts describe the machine this conversation runs on, so do not say the other machine has them.";

/** At most this many setup facts, each this long, go to the model. */
const MAX_FACTS = 25;
const MAX_FACT_CHARS = 160;

/** Instructions to the model, in English, whatever language the person reads. */
const INSTRUCTIONS = `You are One, answering a person who clicked "What is this?" next to a setting in One's Settings. Help them decide, in a back and forth, whether this feature makes sense for their setup.
- If the facts below already decide it, open with your recommendation in one sentence ("You probably do not need this."), then one short reason, then one plain question to confirm. Otherwise say what the feature is in two sentences, then ask.
- Use everyday words. Never write JSON, proxy, endpoint, quota window or API in an answer. Describe a hub as "software you run that gathers several AI accounts behind one address". Use the facts below so you do not ask what you already know.
- Ask exactly one question per reply, answerable with yes or no or a few words, and do not name tools inside the question.
- Name only the providers and accounts listed in the facts. For any other, say "another AI account"; never guess a name.
- Recommend clearly whether it makes sense for them, and why. If it does not, say so and what to do instead. When the person's answer settles it, give the verdict at once and stop asking.
- When it does make sense, give exact steps in this app, named as they appear (for example Usage → Limits, or Settings → Providers → Usage providers → Add hub). Only describe features and settings that appear in the reference notes below.
- Never invent a feature, a setting, a price or a limit. If you are not sure, say so and say what you would check.
- Never ask for, and never repeat, a key, token, password, email address or account id. If the person pastes one, tell them not to share secrets here.
- Keep the first reply under 80 words and later replies under 120. No diagrams or tables unless the person asks. Offer to go further instead of writing everything at once.`;

/** What the model is given about this topic and this person; the person sees none of it. */
export function buildHiddenContext(topicId: ExplainTopicId, setup: SetupSnapshot): string {
  const topic = explainTopic(topicId);
  const facts = topic.facts(setup);
  // A large setup must not push the message past the limit a server accepts.
  const shownFacts = facts.slice(0, MAX_FACTS).map((fact) => fact.slice(0, MAX_FACT_CHARS));
  const omitted = facts.length - shownFacts.length;
  return [
    INSTRUCTIONS,
    `Topic: ${topicId}`,
    `Reference notes (written from what the app does; rely on these):\n${topic.notes}`,
    `Facts about this person's setup (names and states only; nothing secret):\n${
      facts.length === 0
        ? "- None relevant."
        : [
            ...(setup.otherMachineViewed ? [OTHER_MACHINE_LINE] : []),
            ...shownFacts,
            ...(omitted > 0 ? [`and ${omitted} more, not listed`] : []),
          ]
            .map((fact) => `- ${fact}`)
            .join("\n")
    }`,
  ].join("\n\n");
}
