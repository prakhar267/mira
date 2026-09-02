"use client";

import { useState } from "react";
import {
  BellRing,
  BookHeart,
  BookOpen,
  CalendarPlus,
  Check,
  Coins,
  Gamepad2,
  HeartHandshake,
  Leaf,
  Lightbulb,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
} from "lucide-react";
import type {
  ActivityDefinition,
  CompanionMood,
  FutureEventRecord,
  JournalEntryRecord,
  ScheduledNudgeRecord,
  WalletState,
} from "@companion/shared";

const icons = {
  Reflection: BookOpen,
  Games: Gamepad2,
  Growth: Lightbulb,
  Relaxation: Leaf,
  Creativity: Sparkles,
  Relationships: HeartHandshake,
  Fun: Trophy,
} as const;

export function ActivitiesView({
  activities,
  completedIds,
  wallet,
  journalEntries,
  futureEvents,
  nudges,
  companionName,
  liveMode = false,
  onComplete,
  onAddJournal,
  onDeleteJournal,
  onReflect,
  onAddEvent,
}: {
  activities: ActivityDefinition[];
  completedIds: string[];
  wallet: WalletState;
  journalEntries: JournalEntryRecord[];
  futureEvents: FutureEventRecord[];
  nudges: ScheduledNudgeRecord[];
  companionName: string;
  liveMode?: boolean;
  onComplete: (activity: ActivityDefinition) => void;
  onAddJournal: (entry: {
    title: string;
    content: string;
    mood: CompanionMood;
  }) => void;
  onDeleteJournal: (entryId: string) => void;
  onReflect: (entry: JournalEntryRecord) => void;
  onAddEvent: (event: { description: string; eventDate: string }) => void;
}) {
  const [tab, setTab] = useState<"activities" | "journal" | "plans">(
    "activities",
  );
  const [journal, setJournal] = useState({
    title: "",
    content: "",
    mood: "thoughtful" as CompanionMood,
  });
  const [event, setEvent] = useState({ description: "", eventDate: "" });

  const saveFutureEvent = () => {
    if (!event.description.trim()) return;
    const defaultDate = new Date();
    defaultDate.setDate(defaultDate.getDate() + 1);
    defaultDate.setHours(10, 0, 0, 0);
    onAddEvent({
      description: event.description,
      eventDate: event.eventDate
        ? new Date(event.eventDate).toISOString()
        : defaultDate.toISOString(),
    });
    setEvent({ description: "", eventDate: "" });
  };

  return (
    <section
      className="workspace activities-view"
      aria-labelledby="activities-title"
    >
      <header className="workspace-header workspace-header--text">
        <div>
          <span className="eyebrow">Things to do together</span>
          <h1 id="activities-title">Activities & journal</h1>
          <p>
            Play, reflect, or make a small real-world plan. No streaks and no
            pressure.
          </p>
        </div>
        <div className="wallet-pill">
          <Trophy aria-hidden="true" />
          <span>
            Level {wallet.level}
            <small>{wallet.xp} XP</small>
          </span>
          <Coins aria-hidden="true" />
          <strong>{wallet.coins}</strong>
        </div>
      </header>
      <div className="companion-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "activities"}
          onClick={() => setTab("activities")}
        >
          <Sparkles aria-hidden="true" /> Activities
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "journal"}
          onClick={() => setTab("journal")}
        >
          <BookHeart aria-hidden="true" /> Journal
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "plans"}
          onClick={() => setTab("plans")}
        >
          <CalendarPlus aria-hidden="true" /> Future plans
        </button>
      </div>

      {tab === "activities" ? (
        <>
          <div className="activity-feature">
            <div>
              <span className="eyebrow">Suggested for tonight</span>
              <h2>Put the week down for six minutes.</h2>
              <p>
                A guided reflection with {companionName}: one thing that felt heavy, one
                thing that surprised you, and one thing you want to carry
                forward.
              </p>
              <button
                type="button"
                className="button button--primary"
                onClick={() => {
                  const activity = activities.find(
                    (item) => item.id === "reflection" || item.id === "activity-reflection",
                  );
                  if (activity) onComplete(activity);
                }}
              >
                <Sparkles aria-hidden="true" /> Begin with {companionName}
              </button>
            </div>
            <img
              src="/assets/mira/portrait.png"
              alt={`${companionName}, ready to begin a reflection activity`}
            />
          </div>
          <div className="section-heading">
            <div>
              <h2>Explore together</h2>
              <p>Fourteen activities flow back into normal conversation.</p>
            </div>
          </div>
          <div className="activity-grid">
            {activities.map((activity) => {
              const Icon = icons[activity.category];
              const completed = completedIds.includes(activity.id);
              return (
                <article key={activity.id} className="activity-card">
                  <div className="activity-card__icon">
                    <Icon aria-hidden="true" />
                  </div>
                  <span>{activity.category}</span>
                  <h3>{activity.title}</h3>
                  <p>{activity.description}</p>
                  <footer>
                    <small>
                      <Timer aria-hidden="true" /> {activity.durationMinutes}{" "}
                      min
                    </small>
                    <small>
                      <Coins aria-hidden="true" /> +{activity.coinReward}
                    </small>
                    <button
                      type="button"
                      onClick={() => onComplete(activity)}
                      disabled={completed}
                    >
                      {completed ? (
                        <>
                          <Check aria-hidden="true" /> Done
                        </>
                      ) : (
                        "Start"
                      )}
                    </button>
                  </footer>
                </article>
              );
            })}
          </div>
        </>
      ) : null}

      {tab === "journal" ? (
        <div className="journal-layout">
          <form
            className="settings-section"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              if (!journal.title.trim() || !journal.content.trim()) return;
              onAddJournal(journal);
              setJournal({ title: "", content: "", mood: "thoughtful" });
            }}
          >
            <div className="settings-section__heading">
              <BookHeart aria-hidden="true" />
              <div>
                <h2>New private entry</h2>
                <p>
                  {liveMode ? "Saved to your account." : "Saved locally in mock mode."} Sharing with {companionName} is always explicit.
                </p>
              </div>
            </div>
            <label className="field">
              Title
              <input
                required
                maxLength={120}
                value={journal.title}
                onChange={(changeEvent) =>
                  setJournal({ ...journal, title: changeEvent.target.value })
                }
                placeholder="A name for this moment"
              />
            </label>
            <label className="field">
              Mood
              <select
                value={journal.mood}
                onChange={(changeEvent) =>
                  setJournal({
                    ...journal,
                    mood: changeEvent.target.value as CompanionMood,
                  })
                }
              >
                {[
                  "calm",
                  "cheerful",
                  "curious",
                  "excited",
                  "thoughtful",
                  "sleepy",
                ].map((mood) => (
                  <option key={mood}>{mood}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Entry
              <textarea
                required
                rows={7}
                value={journal.content}
                onChange={(changeEvent) =>
                  setJournal({ ...journal, content: changeEvent.target.value })
                }
                placeholder="What feels important today?"
              />
            </label>
            <button type="submit" className="button button--primary">
              Save entry
            </button>
          </form>
          <div className="journal-feed">
            <div className="section-heading">
              <div>
                <h2>Your entries</h2>
                <p>
                  {journalEntries.length
                    ? `${journalEntries.length} saved locally`
                    : "Nothing saved yet"}
                </p>
              </div>
            </div>
            {journalEntries.map((entry) => (
              <article key={entry.id} className="journal-card">
                <span>{entry.mood}</span>
                <h3>{entry.title}</h3>
                <p>{entry.content}</p>
                <footer>
                  <time>{new Date(entry.createdAt).toLocaleDateString()}</time>
                  <button type="button" onClick={() => onReflect(entry)}>
                    <Sparkles aria-hidden="true" /> Reflect with {companionName}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${entry.title}`}
                    onClick={() => onDeleteJournal(entry.id)}
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "plans" ? (
        <div className="journal-layout">
          <form
            className="settings-section"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              saveFutureEvent();
            }}
          >
            <div className="settings-section__heading">
              <CalendarPlus aria-hidden="true" />
              <div>
                <h2>Remember a future moment</h2>
                <p>
                  {companionName} can check in later, within your quiet hours and
                  notification choices.
                </p>
              </div>
            </div>
            <label className="field">
              What’s happening?
              <input
                required
                value={event.description}
                onChange={(changeEvent) =>
                  setEvent({ ...event, description: changeEvent.target.value })
                }
                placeholder="Presentation, appointment, travel…"
              />
            </label>
            <label className="field">
              Date and time <small>Defaults to tomorrow at 10:00</small>
              <input
                type="datetime-local"
                value={event.eventDate}
                onChange={(changeEvent) =>
                  setEvent({ ...event, eventDate: changeEvent.target.value })
                }
              />
            </label>
            <button
              type="button"
              className="button button--primary"
              onClick={saveFutureEvent}
            >
              <BellRing aria-hidden="true" /> Save and plan check-in
            </button>
          </form>
          <div className="journal-feed">
            <div className="section-heading">
              <div>
                <h2>Planned check-ins</h2>
                <p>Consent-aware and cancelable</p>
              </div>
            </div>
            {futureEvents.map((future) => (
              <article key={future.id} className="journal-card">
                <span>{future.status}</span>
                <h3>{future.description}</h3>
                <p>{new Date(future.eventDate).toLocaleString()}</p>
                <footer>
                  <small>
                    {nudges.some((nudge) => nudge.eventId === future.id)
                      ? "A quiet-hours-aware nudge is planned"
                      : "No nudge planned"}
                  </small>
                </footer>
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
