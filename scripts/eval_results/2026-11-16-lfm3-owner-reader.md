# LFM3 as the owner reader: first test (2026-11-16)

Question: can the local LFM3-1.7B (Q4, llama-server) do the reading step of the owner search,
which a hosted model does today on Tue and Thu?

Set: the 28 prospect sites whose own pages mention an owner or founder word, out of 103 sites
read on 2026-11-16. 12 of them name a real owner or decision maker (found by hand the same day;
9 of those are now pending proposals). The other 16 mention the word without naming this
company's owner (reviews, a parent group's history, a leadership list).

One prompt, written once and not tuned. The model got up to three passages around the role
words and answered `{found, name, role, quote}` as JSON.

| | Result |
|---|---|
| Named the same person as the hand reading | 11 of 12 (the twelfth was right but shorter: "Krissada Sukosol") |
| Passed the code check with the model's own quote | 5 of 12 |
| Passed when code picked the quote (name within 90 characters of a role word on the page) | 10 of 12 |
| Sites with no owner where a name still came through, code-picked quote | 4 of 16 |
| Time | 3.1 s median per site |

What it shows:

- LFM3 finds the name. Its quotes are not exact copies, so the existing check (quote on the
  page, name and role inside it) holds most of them. The model should name the person and code
  should find the passage.
- It is not safe alone. The four extra names were a founder from the parent group's history,
  the owners of a partner company, a group chief executive, and a name paired with the next
  person's title. Pat's Save and the DBD link have to stay.
- `--reasoning-budget 0` is required: with thinking on, 220 tokens went to reasoning and the
  answer came back empty (the first two runs of this test).

Limits: 28 sites, one run, labels by the same person who wrote the prompt, no holdout. The
script and saved pages were in a session scratchpad and are not in the repo.
