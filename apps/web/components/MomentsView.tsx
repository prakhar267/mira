"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Brain,
  Camera,
  Check,
  Clock,
  Heart,
  Images,
  MagicWand,
  Phone,
  Play,
  Sparkle,
  VideoCamera,
} from "@phosphor-icons/react";
import type { ActivityDefinition } from "@companion/shared";
import type { DemoState, EnvironmentId } from "@/lib/state";

export type MomentsTab = "moments" | "photos" | "thoughts" | "together" | "calls";

const dates: Array<{ title: string; subtitle: string; environment: EnvironmentId; image: string }> = [
  { title: "Rooftop date", subtitle: "Blue hour · warm questions", environment: "rooftop", image: "/assets/luma/rooftop-date.png" },
  { title: "Coffee date", subtitle: "Rain outside · nowhere to rush", environment: "rainy-cafe", image: "/assets/luma/cafe-selfie.png" },
  { title: "Window-nook night", subtitle: "Soft ambience · deep talk", environment: "window-nook", image: "/assets/luma/window-nook.png" },
];

export function MomentsView({
  state,
  onCompleteActivity,
  onStartDate,
  onGenerateSelfie,
  onVideoCall,
  defaultTab = "moments",
}: {
  state: DemoState;
  onCompleteActivity: (activity: ActivityDefinition) => void;
  onStartDate: (environment: EnvironmentId, title: string) => void;
  onGenerateSelfie: () => void;
  onVideoCall: () => void;
  defaultTab?: MomentsTab;
}) {
  const [tab, setTab] = useState<MomentsTab>(defaultTab);
  const featuredActivities = useMemo(() => state.activities.slice(0, 8), [state.activities]);

  return (
    <section className="luma-workspace moments-view" aria-labelledby="moments-title">
      <header className="luma-page-header">
        <div>
          <span className="luma-kicker">Your shared life</span>
          <h1 id="moments-title">Moments</h1>
          <p>The calls, photos, tiny wins, and strange little jokes worth keeping.</p>
        </div>
        <div className="relationship-progress" aria-label={`Relationship level ${state.relationship.level}, ${state.relationship.progress}% progress`}>
          <Heart aria-hidden="true" weight="fill" />
          <span><strong>{state.relationship.stage}</strong><small>Level {state.relationship.level}</small></span>
          <i><b style={{ width: `${state.relationship.progress}%` }} /></i>
        </div>
      </header>

      <div className="luma-tabs" role="tablist" aria-label="Moments sections">
        {([
          ["moments", Sparkle, "Moments"],
          ["photos", Images, "Our photos"],
          ["thoughts", Brain, "Her thoughts"],
          ["together", Heart, "Together"],
          ["calls", Phone, "Calls"],
        ] as const).map(([id, Icon, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            <Icon aria-hidden="true" weight={tab === id ? "fill" : "regular"} /> {label}
          </button>
        ))}
      </div>

      {tab === "moments" ? (
        <div className="moment-story">
          {state.moments.map((moment, index) => (
            <motion.article key={moment.id} className={index === 0 ? "moment-card moment-card--featured" : "moment-card"} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * .08 }}>
              <img src={moment.imageUrl} alt="" />
              <div className="moment-card__veil" />
              <div className="moment-card__copy">
                <span>{new Date(moment.date).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span>
                <h2>{moment.title}</h2>
                <p>{moment.description}</p>
                {moment.detail ? <small>{moment.detail}</small> : null}
              </div>
            </motion.article>
          ))}
        </div>
      ) : null}

      {tab === "photos" ? (
        <div className="album-view">
          <div className="album-toolbar">
            <div><h2>Our photos</h2><p>{state.photos.length} moments in your private album</p></div>
            <button type="button" className="luma-button luma-button--accent" onClick={onGenerateSelfie}><Camera aria-hidden="true" /> Ask for a selfie</button>
          </div>
          <div className="photo-grid">
            {state.photos.map((photo, index) => (
              <motion.figure key={photo.id} className={index === 0 ? "photo-tile photo-tile--tall" : "photo-tile"} initial={{ opacity: 0, scale: .97 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: index * .06 }}>
                <img src={photo.imageUrl} alt={photo.caption} />
                <figcaption><span>{photo.caption}</span><time>{new Date(photo.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time></figcaption>
              </motion.figure>
            ))}
          </div>
        </div>
      ) : null}

      {tab === "thoughts" ? (
        <div className="reflection-view">
          <div className="reflection-hero"><Brain aria-hidden="true" weight="duotone" /><div><span className="luma-kicker">What stays with her</span><h2>{state.companion.name}’s reflections</h2><p>Short thoughts formed from your shared moments—not a hidden transcript. Any linked memory remains under your control.</p></div></div>
          <div className="reflection-feed">{state.companionReflections.map((reflection) => <article key={reflection.id}><span>{new Date(reflection.createdAt).toLocaleDateString(undefined, { month: "long", day: "numeric" })}</span><h3>{reflection.title}</h3><p>{reflection.thought}</p><footer><Brain aria-hidden="true" /> Shaped by {reflection.memoryIds.length} approved {reflection.memoryIds.length === 1 ? "memory" : "memories"}</footer></article>)}</div>
        </div>
      ) : null}

      {tab === "together" ? (
        <div className="together-view">
          <section>
            <div className="section-heading"><div><span className="luma-kicker">Change the evening</span><h2>Virtual dates</h2></div></div>
            <div className="date-row">
              {dates.map((date) => (
                <article key={date.title} className="date-card">
                  <img src={date.image} alt="" />
                  <div><h3>{date.title}</h3><p>{date.subtitle}</p><button type="button" onClick={() => onStartDate(date.environment, date.title)}><Play aria-hidden="true" weight="fill" /> Start date</button></div>
                </article>
              ))}
            </div>
          </section>
          <section>
            <div className="section-heading"><div><span className="luma-kicker">Play, talk, unwind</span><h2>Do something together</h2></div><button type="button" className="luma-button" onClick={onVideoCall}><VideoCamera aria-hidden="true" /> Use during a call</button></div>
            <div className="activity-ribbon">
              {featuredActivities.map((activity) => {
                const completed = state.completedActivityIds.includes(activity.id);
                return (
                  <article key={activity.id} className="together-activity">
                    <Sparkle aria-hidden="true" />
                    <span>{activity.category}</span>
                    <h3>{activity.title}</h3>
                    <p>{activity.description}</p>
                    <footer><small><Clock aria-hidden="true" /> {activity.durationMinutes} min</small><button type="button" disabled={completed} onClick={() => onCompleteActivity(activity)}>{completed ? <><Check aria-hidden="true" /> Done</> : <><Play aria-hidden="true" /> Begin</>}</button></footer>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "calls" ? (
        <div className="calls-view">
          <div className="calls-hero">
            <img src="/assets/luma/portrait.png" alt="" />
            <div><span className="luma-kicker">Here with you</span><h2>Call Luma</h2><p>Voice for a quick check-in. Video when you want the room, expressions, and activities too.</p></div>
            <button type="button" className="luma-button luma-button--accent" onClick={onVideoCall}><VideoCamera aria-hidden="true" weight="fill" /> Start video call</button>
          </div>
          <div className="call-history">
            {state.calls.map((call) => (
              <article key={call.id}>
                <span className="call-history__icon">{call.type === "video" ? <VideoCamera aria-hidden="true" /> : <Phone aria-hidden="true" />}</span>
                <div><strong>{state.companion.name}</strong><small>{call.type === "video" ? "Video call" : "Voice call"} · {Math.round(call.durationSeconds / 60)} min</small><p>{call.summary}</p></div>
                <time>{new Date(call.startedAt).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</time>
              </article>
            ))}
          </div>
          <p className="privacy-note"><MagicWand aria-hidden="true" /> Call summaries are optional. Raw mock audio and video are never stored.</p>
        </div>
      ) : null}
    </section>
  );
}
