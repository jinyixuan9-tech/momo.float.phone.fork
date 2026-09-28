"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Mic2,
  Menu,
  Pause,
  PencilLine,
  Plus,
  Radio,
  Send,
  Volume2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

import { loadCharacters } from "@/lib/character-storage";
import { playAudioBlobViaMediaElement, resolveVoiceConfig, synthesizeSpeech, unlockAudioPlayback } from "@/lib/tts-service";
import { splitBilingualText } from "@/lib/bilingual-text";
import type { Character } from "@/lib/character-types";
import type { UserIdentity } from "@/components/settings/user-identity";
import {
  composeInterviewArticle,
  formatInterviewTranscript,
  generateCharacterInterviewAnswer,
  generateInterviewAudienceReactions,
  generateHostOpening,
  generateHostQuestion,
  makeInterviewMessage,
} from "@/lib/interview-magazine-engine";
import {
  deleteInterviewDraft,
  deleteInterviewIssue,
  getNextInterviewIssueNumber,
  loadInterviewDrafts,
  loadInterviewHostOverrides,
  loadInterviewIssues,
  loadInterviewProgrammes,
  saveInterviewProgrammes,
  saveInterviewDraft,
  saveInterviewHostOverrides,
  saveInterviewIssue,
} from "@/lib/interview-magazine-storage";
import {
  deleteInterviewMagazineProjectionEventForIssue,
  recordInterviewMagazineProjectionEvent,
} from "@/lib/interview-magazine-memory";
import {
  INTERVIEW_MAGAZINE_HOST_NAME,
  INTERVIEW_MAGAZINE_TITLE,
  INTERVIEW_MAGAZINE_TITLE_CN,
  BUILTIN_INTERVIEW_PROGRAMMES,
  BUILTIN_INTERVIEW_HOSTS,
  type InterviewHost,
  type InterviewProgramme,
  type InterviewDraft,
  type InterviewDraftStatus,
  type InterviewIssue,
  type InterviewMessage,
} from "@/lib/interview-magazine-types";
import { incrementEventCounter } from "@/lib/memory-storage";
import { maybeRunSummarization } from "@/lib/memory-summarizer";
import { loadUserIdentities, resolveUserIdentity } from "@/lib/settings-storage";

type Props = {
  onClose: () => void;
};

type Screen = "home" | "setup" | "interview" | "generating" | "article";
type InterviewPhase = "opening" | "host" | "character" | "user" | "paused" | "done" | "error";
type InterviewResumeAction =
  | { type: "next"; baseMessages: InterviewMessage[]; round: number; currentTheme: string }
  | { type: "opening"; theme: string }
  | { type: "awaitUser" }
  | { type: "finish"; baseMessages: InterviewMessage[] }
  | {
      type: "character";
      question: string;
      baseMessages: InterviewMessage[];
      round: number;
      answeringCharacterId: string;
      lastUserAnswer?: string;
      currentTheme: string;
    }
  | { type: "hostToUser"; baseMessages: InterviewMessage[]; currentTheme: string }
  | {
      type: "hostToCharacter";
      baseMessages: InterviewMessage[];
      lastUserAnswer: string;
      fallbackTargetCharacterId: string;
      nextRound: number;
      currentTheme: string;
    };

const THEME_CHIPS = ["关系的暗面", "一次漫长的告别", "未完成的愿望", "被误解的瞬间", "选择的代价", "夜里真实的自己"];
const CHINESE_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

function formatChineseOrdinalNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return String(value);
  if (value < 10) return CHINESE_DIGITS[value];
  if (value < 20) return `十${value % 10 === 0 ? "" : CHINESE_DIGITS[value % 10]}`;
  if (value < 100) {
    const tens = Math.floor(value / 10);
    const ones = value % 10;
    return `${CHINESE_DIGITS[tens]}十${ones === 0 ? "" : CHINESE_DIGITS[ones]}`;
  }
  if (value < 1000) {
    const hundreds = Math.floor(value / 100);
    const rest = value % 100;
    return `${CHINESE_DIGITS[hundreds]}百${rest === 0 ? "" : formatChineseOrdinalNumber(rest)}`;
  }
  return String(value);
}

function resolveSuggestedIdentityId(characterIds: string[], identities: UserIdentity[]): string {
  if (identities.length === 0) return "";
  const resolved = characterIds
    .map((id) => resolveUserIdentity(id, "interview_magazine"))
    .filter(Boolean) as UserIdentity[];
  const uniqueIds = new Set(resolved.map((identity) => identity.id));
  if (resolved.length > 0 && uniqueIds.size === 1) return resolved[0].id;
  return identities[0]?.id ?? "";
}

function hasMixedIdentityBindings(characterIds: string[]): boolean {
  const resolved = characterIds
    .map((id) => resolveUserIdentity(id, "interview_magazine")?.id)
    .filter(Boolean);
  return new Set(resolved).size > 1;
}

function getMaxCharacterTurns(count: number): number {
  return Math.min(12, Math.max(6, count * 3));
}

function getIssueGuestNames(issue: InterviewIssue): string[] {
  if (issue.characterIds && issue.characterIds.length === 0) return [];
  if (issue.characterNames && issue.characterNames.length > 0) return issue.characterNames;
  if (issue.guestSnapshots && issue.guestSnapshots.length > 0) {
    return issue.guestSnapshots.map((guest) => guest.characterName);
  }
  return [issue.characterName].filter(Boolean);
}

function getIssueParticipantText(issue: InterviewIssue): string {
  return [getIssueGuestNames(issue).join("、"), issue.includeUser === false ? "" : issue.userName || "用户"].filter(Boolean).join(" · ");
}

function getDraftParticipantText(draft: InterviewDraft): string {
  const names = draft.characterNames.length > 0 ? draft.characterNames : draft.characterIds;
  return [names.join("、"), draft.includeUser === false ? "" : draft.userName || "用户"].filter(Boolean).join(" · ");
}

function getDraftStatusText(status: InterviewDraftStatus): string {
  if (status === "error") return "录制中断";
  if (status === "awaiting_user") return "等待回应";
  if (status === "done") return "待生成节目回顾";
  return "已暂停";
}

function getIssueCharacterNameMap(issue: InterviewIssue): Record<string, string> {
  if (issue.guestSnapshots && issue.guestSnapshots.length > 0) {
    return Object.fromEntries(issue.guestSnapshots.map((guest) => [guest.characterId, guest.characterName]));
  }
  return issue.characterId ? { [issue.characterId]: issue.characterName } : {};
}

function InterviewBilingualAnswer({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const bilingual = splitBilingualText(text);
  if (!bilingual || bilingual.original === bilingual.translated) return <>{text}</>;
  return <span className="interview-bilingual-answer">
    <span>{bilingual.original}</span>
    <button type="button" className="interview-bilingual-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>{open ? "收起译文" : "展开译文"}</button>
    {open ? <span className="interview-bilingual-translation">{bilingual.translated}</span> : null}
  </span>;
}

const interviewVoiceCache = new Map<string, Blob>();
function InterviewVoiceButton({ text, characterId }: { text: string; characterId?: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const [notice, setNotice] = useState("");
  const playback = useRef<{ promise: Promise<void>; abort: () => void } | null>(null);
  const requestId = useRef(0);
  useEffect(() => () => { requestId.current += 1; playback.current?.abort(); }, []);
  if (!characterId) return null;
  const original = splitBilingualText(text)?.original || text;
  const play = async () => {
    requestId.current += 1;
    playback.current?.abort();
    if (state !== "idle") { setState("idle"); return; }
    const voice = resolveVoiceConfig(characterId, "interview_magazine");
    if (!voice?.enableTTS) { setNotice("请先给该角色绑定在场语音方案"); return; }
    setNotice("");
    unlockAudioPlayback();
    const id = requestId.current;
    setState("loading");
    try {
      const key = [voice.id, voice.defaultVoice || "", voice.speechSpeed ?? 1, original].join("::");
      let blob = interviewVoiceCache.get(key);
      if (!blob) {
        blob = await synthesizeSpeech(original, voice) || undefined;
        if (blob) {
          if (interviewVoiceCache.size > 60) interviewVoiceCache.delete(interviewVoiceCache.keys().next().value!);
          interviewVoiceCache.set(key, blob);
        }
      }
      if (id !== requestId.current) return;
      if (!blob) throw new Error("语音服务没有返回音频");
      playback.current = playAudioBlobViaMediaElement(blob);
      setState("playing");
      await playback.current.promise;
    } catch (error) {
      if (id === requestId.current) setNotice(error instanceof Error ? error.message : "播放失败");
    } finally {
      if (id === requestId.current) { playback.current = null; setState("idle"); }
    }
  };
  return <span className="interview-voice-control">
    <button type="button" className="interview-voice-btn" onClick={() => void play()} aria-label={state === "idle" ? "播放原话" : "停止播放原话"} title={state === "idle" ? "播放原话" : "停止播放"}>{state === "loading" ? <Loader2 size={14} className="interview-spin" /> : state === "playing" ? <Pause size={13} /> : <Volume2 size={14} />}</button>
    {notice ? <small role="status">{notice}</small> : null}
  </span>;
}

function SmallCaps({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`interview-small-caps ${className}`}>{children}</span>;
}

function BackgroundLayer({ imageUrl }: { imageUrl?: string | null }) {
  return (
    <div className="interview-glass-bg">
      {imageUrl ? (
        <img src={imageUrl} alt="" />
      ) : (
        <div className="w-full h-full bg-gradient-to-br from-stone-900 to-black" />
      )}
      <div className="overlay" />
    </div>
  );
}

export function InterviewMagazineApp({ onClose }: Props) {
  const [screen, setScreen] = useState<Screen>("home");
  const [issues, setIssues] = useState<InterviewIssue[]>([]);
  const [drafts, setDrafts] = useState<InterviewDraft[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [userIdentities, setUserIdentities] = useState<UserIdentity[]>([]);
  const [activeIssue, setActiveIssue] = useState<InterviewIssue | null>(null);
  const [theme, setTheme] = useState("");
  const [programmes, setProgrammes] = useState<InterviewProgramme[]>([]);
  const [hostOverrides, setHostOverrides] = useState<InterviewHost[]>([]);
  const [programmeId, setProgrammeId] = useState("interview");
  const [includeUser, setIncludeUser] = useState(false);
  const [audienceEnabled, setAudienceEnabled] = useState(true);
  const [hostCharacterId, setHostCharacterId] = useState("");
  const [hostCharacterIds, setHostCharacterIds] = useState<string[]>([]);
  const [hostPresetId, setHostPresetId] = useState("jian");
  const programme = programmes.find(p => p.id === programmeId) || BUILTIN_INTERVIEW_PROGRAMMES.find(p => p.id === programmeId) || BUILTIN_INTERVIEW_PROGRAMMES[0];
  const availableHosts = [...BUILTIN_INTERVIEW_HOSTS, ...(!BUILTIN_INTERVIEW_PROGRAMMES.some(item => item.id === programmeId) ? [{ id: `host_${programmeId}`, programmeId, name: "栏目主持人", language: "韩语", direction: programme.hostStyle || programme.direction }] : [])].map(host => hostOverrides.find(override => override.id === host.id) || host).filter(host => host.programmeId === programmeId);
  const hostPresent = programme.hostRule === "required" || (programme.hostRule !== "none" && (hostCharacterId !== "none"));
  const effectiveHostId = availableHosts.some(host => host.id === hostPresetId) ? hostPresetId : availableHosts[0]?.id || hostPresetId;
  const selectedHostName = !hostPresent ? "无主持人" : hostCharacterId && hostCharacterId !== "none" ? hostCharacterIds.length ? hostCharacterIds.map(id => characters.find(c => c.id === id)?.name).filter(Boolean).join("、") : characters.find(c => c.id === hostCharacterId)?.name || INTERVIEW_MAGAZINE_HOST_NAME : availableHosts.find(item => item.id === effectiveHostId)?.name || programme.name;
  const runOptions = { programme, includeUser, hostPresent, hostCharacterId: hostCharacterId && hostCharacterId !== "none" ? hostCharacterId : undefined, hostCharacterIds, hostPresetId: effectiveHostId, hostOverrides, audienceEnabled };
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [userIdentityId, setUserIdentityId] = useState("");
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [phase, setPhase] = useState<InterviewPhase>("opening");
  const [pendingLabel, setPendingLabel] = useState("");
  const [userInput, setUserInput] = useState("");
  const [inputMode, setInputMode] = useState<"speech" | "barrage" | "direction">("speech");
  const [error, setError] = useState("");
  const [resumeAction, setResumeAction] = useState<InterviewResumeAction | null>(null);
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [characterRounds, setCharacterRounds] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composeRunRef = useRef(0);
  const resumeActionRef = useRef<InterviewResumeAction | null>(null);
  const interviewRunRef = useRef(0);

  useEffect(() => {
    setIssues(loadInterviewIssues());
    setDrafts(loadInterviewDrafts());
    setProgrammes(loadInterviewProgrammes());
    setHostOverrides(loadInterviewHostOverrides());
    const loadedCharacters = loadCharacters();
    const loadedIdentities = loadUserIdentities();
    setCharacters(loadedCharacters);
    setUserIdentities(loadedIdentities);
    const firstCharacterId = loadedCharacters[0]?.id ?? "";
    setSelectedCharacterIds(firstCharacterId ? [firstCharacterId] : []);
    setUserIdentityId(resolveSuggestedIdentityId(firstCharacterId ? [firstCharacterId] : [], loadedIdentities));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, phase]);

  useEffect(() => {
    if (userIdentities.length === 0) return;
    if (userIdentityId && userIdentities.some((identity) => identity.id === userIdentityId)) return;
    setUserIdentityId(resolveSuggestedIdentityId(selectedCharacterIds, userIdentities));
  }, [selectedCharacterIds, userIdentities, userIdentityId]);

  useEffect(() => {
    if (hostCharacterId && hostCharacterId !== "none" && !selectedCharacterIds.includes(hostCharacterId)) { setHostCharacterId(""); setHostCharacterIds([]); }
  }, [hostCharacterId, selectedCharacterIds]);

  const activeCharacters = useMemo(
    () => selectedCharacterIds
      .map((id) => characters.find((character) => character.id === id))
      .filter(Boolean) as Character[],
    [characters, selectedCharacterIds],
  );

  const activeCharacter = activeCharacters[0] ?? null;
  const maxCharacterTurns = getMaxCharacterTurns(Math.max(1, selectedCharacterIds.length));

  const bgImageUrl = activeIssue?.guestSnapshots?.[0]?.characterSnapshot?.avatar
    || activeIssue?.characterSnapshot?.avatar
    || activeCharacter?.avatar
    || (activeIssue?.characterIds?.length === 0 || selectedCharacterIds.length === 0 ? null : characters[0]?.avatar);

  const resetDraft = () => {
    setTheme("");
    setMessages([]);
    setPhase("opening");
    setPendingLabel("");
    setUserInput("");
    setError("");
    setResumeAction(null);
    setActiveDraftId(null);
    resumeActionRef.current = null;
    setCharacterRounds(0);
  };

  const saveProgramme = (name: string, description: string, direction: string, hostRule: InterviewProgramme["hostRule"], characterRadio: boolean, hostStyle: string) => {
    const custom: InterviewProgramme = { id: `programme_${Date.now()}`, name: name.trim(), description: description.trim(), direction: direction.trim(), hostRule, characterRadio, hostStyle: hostStyle.trim(), hostPrompt: direction.trim(), memoryPrompt: "用第三人称总结实际播出的话题、参与者发言和关系变化；用户没有作为嘉宾参与时不要把用户写成嘉宾。不要编造未发生的经历，匿名弹幕的身份猜测不得写成事实。" };
    if (!custom.name || !custom.direction) return;
    const next = [...programmes, custom];
    saveInterviewProgrammes(next);
    setProgrammes(next);
    setProgrammeId(custom.id);
  };

  const updateProgramme = (updated: InterviewProgramme) => {
    const next = [...programmes.filter(item => item.id !== updated.id), updated];
    saveInterviewProgrammes(next);
    setProgrammes(next);
  };

  const updateHost = (updated: InterviewHost) => {
    const next = [...hostOverrides.filter(item => item.id !== updated.id), updated];
    saveInterviewHostOverrides(next);
    setHostOverrides(next);
  };

  const removeProgramme = (id: string) => {
    const next = programmes.filter(item => item.id !== id);
    saveInterviewProgrammes(next);
    setProgrammes(next);
    if (programmeId === id) setProgrammeId("interview");
  };

  const armResumeAction = (action: InterviewResumeAction) => {
    resumeActionRef.current = action;
    setResumeAction(action);
    setError("");
  };

  const clearResumeAction = () => {
    resumeActionRef.current = null;
    setResumeAction(null);
  };

  const pauseInterview = () => {
    if (!resumeActionRef.current) return;
    stopInterviewRun();
    setError("");
    setPendingLabel("");
    setPhase("paused");
    persistCurrentDraft("paused");
  };

  const startInterviewRun = () => {
    const runId = interviewRunRef.current + 1;
    interviewRunRef.current = runId;
    return runId;
  };

  const stopInterviewRun = () => {
    interviewRunRef.current += 1;
  };

  const isInterviewRunCurrent = (runId: number) => interviewRunRef.current === runId;

  const resolveDraftStatus = (): InterviewDraftStatus => {
    if (phase === "error") return "error";
    if (phase === "user") return "awaiting_user";
    if (phase === "done") return "done";
    return "paused";
  };

  const createCurrentDraft = (status = resolveDraftStatus()): InterviewDraft | null => {
    const trimmedTheme = theme.trim();
    if (!trimmedTheme || (selectedCharacterIds.length === 0 && !includeUser)) return null;
    const previousDraft = activeDraftId ? drafts.find((draft) => draft.id === activeDraftId) : null;
    const now = new Date().toISOString();
    const action = status === "awaiting_user"
      ? { type: "awaitUser" as const }
      : status === "done"
        ? undefined
        : resumeActionRef.current ?? undefined;
    return {
      id: activeDraftId || `interview_draft_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      theme: trimmedTheme,
      programme,
      hostCharacterId: hostCharacterId || undefined,
      hostPresetId,
      hostOverrides,
      hostCharacterIds,
      includeUser,
      audienceEnabled,
      characterIds: selectedCharacterIds,
      characterNames: activeCharacters.map((character) => character.name),
      userIdentityId,
      userName: userIdentities.find((identity) => identity.id === userIdentityId)?.name,
      transcript: messages,
      characterRounds,
      status,
      resumeAction: action,
      userInput,
      error,
      createdAt: previousDraft?.createdAt || now,
      updatedAt: now,
    };
  };

  const persistCurrentDraft = (status = resolveDraftStatus()) => {
    const draft = createCurrentDraft(status);
    if (!draft) return null;
    setDrafts(saveInterviewDraft(draft));
    setActiveDraftId(draft.id);
    return draft;
  };

  const inferDraftResumeAction = (draft: InterviewDraft): InterviewResumeAction | null => {
    const action = draft.resumeAction as InterviewResumeAction | null | undefined;
    if (action) return action;
    if (draft.status === "awaiting_user") return { type: "awaitUser" };
    if (draft.status === "done") return null;
    if (draft.transcript.length === 0) return { type: "opening", theme: draft.theme };
    return { type: "awaitUser" };
  };

  const openDraft = (draft: InterviewDraft) => {
    stopInterviewRun();
    startInterviewRun();
    const action = inferDraftResumeAction(draft);
    setActiveDraftId(draft.id);
    setTheme(draft.theme);
    setProgrammeId(draft.programme?.id || "interview");
    setHostCharacterId(draft.hostCharacterId || "");
    setHostPresetId(draft.hostPresetId || "jian");
    setHostCharacterIds(draft.hostCharacterIds || (draft.hostCharacterId ? [draft.hostCharacterId] : []));
    setIncludeUser(draft.includeUser !== false);
    setAudienceEnabled(draft.audienceEnabled !== false);
    setSelectedCharacterIds(draft.characterIds);
    setUserIdentityId(draft.userIdentityId || resolveSuggestedIdentityId(draft.characterIds, userIdentities));
    setMessages(draft.transcript);
    setCharacterRounds(draft.characterRounds);
    setUserInput(draft.userInput || "");
    setInputMode(draft.includeUser === false ? "barrage" : "speech");
    setError(draft.error || "");
    resumeActionRef.current = action;
    setResumeAction(action);
    setPendingLabel("");
    setPhase(
      draft.status === "awaiting_user"
        ? "user"
        : draft.status === "done"
          ? "done"
          : draft.status === "error"
            ? "error"
            : "paused",
    );
    setScreen("interview");
  };

  const exitInterviewToHome = () => {
    persistCurrentDraft(resolveDraftStatus());
    stopInterviewRun();
    resetDraft();
    setScreen("home");
  };

  const toggleCharacter = (id: string) => {
    setSelectedCharacterIds((previous) => {
      const next = previous.includes(id)
        ? previous.filter((characterId) => characterId !== id)
        : [...previous, id];
      if (next.length > 0 && !userIdentityId) {
        setUserIdentityId(resolveSuggestedIdentityId(next, userIdentities));
      }
      return next;
    });
  };

  const getNextCharacterId = (currentCharacterId?: string): string => {
    const guests = selectedCharacterIds.filter(id => !hostCharacterIds.includes(id));
    const candidates = guests.length ? guests : selectedCharacterIds;
    if (candidates.length === 0) return "";
    const currentIndex = currentCharacterId ? candidates.indexOf(currentCharacterId) : -1;
    return candidates[(currentIndex + 1 + candidates.length) % candidates.length];
  };

  const audienceMessages = (reactions: string[]) => reactions.slice(0, 5).map(content => makeInterviewMessage("audience", content, { speakerName: "匿名", audienceSource: "simulated" }));

  const settleTurn = async (baseMessages: InterviewMessage[], round: number, runId: number, reactions?: string[]) => {
    if (!isInterviewRunCurrent(runId)) return;
    let generated = reactions || [];
    if (!reactions && audienceEnabled) {
      try { generated = await generateInterviewAudienceReactions({ theme, characterIds: selectedCharacterIds, userIdentityId, transcript: baseMessages, options: runOptions }); }
      catch { generated = []; } // A reaction request must not interrupt the recording.
    }
    if (!isInterviewRunCurrent(runId)) return;
    const next = [...baseMessages, ...audienceMessages(generated)];
    setMessages(next);
    setCharacterRounds(round);
    setPendingLabel("");
    if (round >= maxCharacterTurns) {
      setPhase("done");
      clearResumeAction();
    } else {
      setPhase("user");
      armResumeAction({ type: "next", baseMessages: next, round, currentTheme: theme });
    }
  };

  const runCharacterAnswer = async (
    question: string, baseMessages: InterviewMessage[], round: number,
    answeringCharacterId: string, lastUserAnswer?: string, currentTheme?: string,
    runId = interviewRunRef.current,
  ) => {
    const activeTheme = currentTheme || theme;
    const answeringCharacter = characters.find(character => character.id === answeringCharacterId);
    if (!answeringCharacter) throw new Error("找不到本轮参与的角色。");
    setPhase("character");
    setPendingLabel(answeringCharacter.name);
    armResumeAction({ type: "character", question, baseMessages, round, answeringCharacterId, lastUserAnswer, currentTheme: activeTheme });
    const answer = await generateCharacterInterviewAnswer({
      theme: activeTheme, characterIds: selectedCharacterIds, characterId: answeringCharacterId,
      userIdentityId, question, transcript: baseMessages, round, lastUserAnswer, options: runOptions,
    });
    if (!isInterviewRunCurrent(runId)) return;
    const withAnswer = [...baseMessages, makeInterviewMessage("character", answer, { kind: "answer", speakerCharacterId: answeringCharacterId, speakerName: answeringCharacter.name })];
    setMessages(withAnswer);
    await settleTurn(withAnswer, round, runId);
  };

  const startInterview = async () => {
    const trimmedTheme = theme.trim();
    const count = selectedCharacterIds.length;
    const castCount = count + (includeUser ? 1 : 0);
    const guestCount = count - hostCharacterIds.filter(id => selectedCharacterIds.includes(id)).length;
    if (!trimmedTheme || (count === 0 && !includeUser)) return;
    if (programme.characterRadio && (!hostPresent || !hostCharacterIds.length)) { setError("角色电台至少选一位角色主持人。"); return; }
    if (programme.id === "roundtable" && (hostPresent ? guestCount + (includeUser ? 1 : 0) < 2 : castCount < 3)) { setError("日月闲至少要有三位参与者；有主持人时，另需两位嘉宾（角色或用户）。"); return; }
    if (!hostPresent && count === 0) { setError("没有主持人的节目至少需要一位角色来开聊。"); return; }
    resetDraft();
    const runId = startInterviewRun();
    setTheme(trimmedTheme);
    setScreen("interview");
    setPhase("opening");
    setPendingLabel(hostPresent ? `主持人 ${selectedHostName}` : "参与者准备开播");
    armResumeAction({ type: "opening", theme: trimmedTheme });
    try {
      if (!hostPresent) {
        await runCharacterAnswer(`围绕「${trimmedTheme}」自然开场，像和身旁的人聊起话题，可以抛出一个有趣的细节。`, [], 1, selectedCharacterIds[0], undefined, trimmedTheme, runId);
        return;
      }
      const opening = await generateHostOpening(trimmedTheme, selectedCharacterIds, userIdentityId, runOptions);
      if (!isInterviewRunCurrent(runId)) return;
      const firstTarget = count ? "character" : "user";
      const initialMessages = [
        makeInterviewMessage("host", opening.intro, { kind: "intro", speakerCharacterId: runOptions.hostCharacterId, speakerName: selectedHostName }),
        makeInterviewMessage("host", opening.question, { kind: "question", target: firstTarget, targetCharacterId: opening.targetCharacterId, targetCharacterName: opening.targetCharacterName, speakerCharacterId: runOptions.hostCharacterId, speakerName: selectedHostName }),
      ];
      setMessages(initialMessages);
      if (count) await runCharacterAnswer(opening.question, initialMessages, 1, opening.targetCharacterId || selectedCharacterIds[0], undefined, trimmedTheme, runId);
      else { setPhase("user"); setPendingLabel(""); armResumeAction({ type: "next", baseMessages: initialMessages, round: 0, currentTheme: trimmedTheme }); }
    } catch (err) {
      if (!isInterviewRunCurrent(runId)) return;
      setError(err instanceof Error ? err.message : String(err)); setPhase("error"); setPendingLabel("");
    }
  };

  const submitUserAnswer = () => {
    const answer = userInput.trim();
    if (phase !== "user") return;
    if (!answer) { void continueInterview(); return; }
    setUserInput("");
    const mode = includeUser ? inputMode : inputMode === "speech" ? "barrage" : inputMode;
    const next = [...messages, makeInterviewMessage(mode === "speech" ? "user" : mode === "barrage" ? "audience" : "direction", answer, { kind: "answer", speakerName: mode === "barrage" ? "匿名" : mode === "direction" ? "幕后提示" : undefined, audienceSource: mode === "barrage" ? "user" : undefined })];
    setMessages(next);
    armResumeAction({ type: "next", baseMessages: next, round: characterRounds, currentTheme: theme });
  };

  const continueInterview = async () => {
    const action = resumeActionRef.current;
    if (!action) return;
    const runId = startInterviewRun();
    setError(""); setScreen("interview");
    try {
      if (action.type === "opening") { await startInterview(); return; }
      if (action.type === "character") {
        await runCharacterAnswer(action.question, action.baseMessages, action.round, action.answeringCharacterId, action.lastUserAnswer, action.currentTheme, runId);
        return;
      }
      const baseMessages = action.type === "next" ? messages : action.type === "hostToCharacter" || action.type === "hostToUser" || action.type === "finish" ? action.baseMessages : messages;
      const round = action.type === "next" ? action.round : characterRounds;
      if (round >= maxCharacterTurns) { setPhase("done"); clearResumeAction(); return; }
      if (!hostPresent) {
        const nextId = getNextCharacterId([...baseMessages].reverse().find(message => message.role === "character")?.speakerCharacterId);
        const lastSpeech = [...baseMessages].reverse().find(message => message.role === "character" || message.role === "user" || message.role === "direction")?.content;
        await runCharacterAnswer(`自然接住刚才的话继续聊天。${lastSpeech || `话题：「${theme}」`}`, baseMessages, round + 1, nextId, undefined, theme, runId);
        return;
      }
      setPhase("host"); setPendingLabel(`主持人 ${selectedHostName}`);
      armResumeAction({ type: "next", baseMessages, round, currentTheme: theme });
      // The user may speak as often as they wish; a host can occasionally address them, without blocking other guests.
      const lastWasUserQuestion = [...baseMessages].reverse().find(message => message.role === "host" && message.kind === "question")?.target === "user";
      const target = selectedCharacterIds.length === 0 || (includeUser && round > 0 && round % 3 === 0 && !lastWasUserQuestion) ? "user" : "character";
      const lastCharacterId = [...baseMessages].reverse().find(message => message.role === "character")?.speakerCharacterId;
      const fallbackTargetCharacterId = getNextCharacterId(lastCharacterId);
      const speakingHostId = hostCharacterIds.length > 1 ? hostCharacterIds[round % hostCharacterIds.length] : runOptions.hostCharacterId;
      const speakingHostName = speakingHostId ? characters.find(character => character.id === speakingHostId)?.name || selectedHostName : selectedHostName;
      const nextQuestion = await generateHostQuestion({
        theme, characterIds: selectedCharacterIds, userIdentityId, transcript: baseMessages,
        target, fallbackTargetCharacterId, options: { ...runOptions, hostCharacterId: speakingHostId, audienceEnabled: target === "user" && audienceEnabled },
        phase: target === "user" ? "自然邀请用户分享，允许用户不回答；如果已经几轮没说话，可轻轻关心一次" : "把话题抛给下一位嘉宾，不要求用户回答；根据匿名弹幕可偶尔猜测但不能断言身份",
      });
      if (!isInterviewRunCurrent(runId)) return;
      const question = makeInterviewMessage("host", nextQuestion.question, { kind: "question", target, targetCharacterId: target === "character" ? nextQuestion.targetCharacterId || fallbackTargetCharacterId : undefined, targetCharacterName: nextQuestion.targetCharacterName, speakerCharacterId: speakingHostId, speakerName: speakingHostName });
      const withQuestion = [...baseMessages, ...audienceMessages(nextQuestion.reactions), question];
      setMessages(withQuestion);
      if (target === "user") { setPhase("user"); setPendingLabel(""); setCharacterRounds(round + 1); armResumeAction({ type: "next", baseMessages: withQuestion, round: round + 1, currentTheme: theme }); }
      else await runCharacterAnswer(nextQuestion.question, withQuestion, round + 1, nextQuestion.targetCharacterId || fallbackTargetCharacterId, undefined, theme, runId);
    } catch (err) {
      if (!isInterviewRunCurrent(runId)) return;
      setError(err instanceof Error ? err.message : String(err)); setPhase("error"); setPendingLabel("");
    }
  };

  const composeArticle = async () => {
    if ((selectedCharacterIds.length === 0 && !includeUser) || messages.length === 0) return;
    const composeRunId = composeRunRef.current + 1;
    composeRunRef.current = composeRunId;
    setScreen("generating");
    setError("");
    try {
      const issueNumber = getNextInterviewIssueNumber();
      const result = await composeInterviewArticle({
        theme,
        characterIds: selectedCharacterIds,
        userIdentityId,
        transcript: messages,
        issueNumber,
        options: runOptions,
      });
      if (composeRunRef.current !== composeRunId) return;
      const now = new Date().toISOString();
      const issue: InterviewIssue = {
        id: `issue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        issueNumber,
        theme,
        programme,
        hostCharacterId: hostCharacterId || undefined,
        hostPresetId: effectiveHostId,
        hostOverrides,
        hostCharacterIds,
        includeUser,
        audienceEnabled,
        characterIds: result.context.guests.map((guest) => guest.character.id),
        characterNames: result.context.guestNames,
        characterId: result.context.guests[0]?.character.id || "",
        characterName: result.context.guests.length ? result.context.guestListText : result.context.userName,
        userName: result.context.userName,
        userIdentityId,
        guestSnapshots: result.context.guestSnapshots,
        characterSnapshot: result.context.guests.length ? result.context.characterSnapshot : { ...result.context.characterSnapshot, id: "", name: result.context.userName, avatar: null, persona: "", tags: [] },
        userSnapshot: result.context.userSnapshot,
        worldBookSnapshot: result.context.worldBookSnapshot,
        transcript: messages,
        article: result.article,
        createdAt: now,
        updatedAt: now,
      };
      const savedIssues = saveInterviewIssue(issue);
      recordInterviewMagazineProjectionEvent({
        issueId: issue.id,
        issueNumber,
        title: issue.article.title,
        theme,
        characterIds: issue.characterIds || [issue.characterId],
        characterNames: issue.characterNames || [issue.characterName],
        userName: issue.userName,
        includeUser,
        summary: issue.article.memorySummary || issue.article.subtitle,
        timestamp: now,
      });
      for (const guest of result.context.guests) {
        incrementEventCounter(guest.character.id);
        maybeRunSummarization(guest.character.id, guest.character.name).catch((summarizeError) => {
          console.warn("[InterviewMagazine] Summarization check failed:", summarizeError);
        });
      }
      setIssues(savedIssues);
      if (activeDraftId) {
        setDrafts(deleteInterviewDraft(activeDraftId));
        setActiveDraftId(null);
      }
      clearResumeAction();
      setActiveIssue(issue);
      setScreen("article");
    } catch (err) {
      if (composeRunRef.current !== composeRunId) return;
      setError(err instanceof Error ? err.message : String(err));
      setScreen("interview");
      setPhase("error");
    }
  };

  const cancelGenerating = () => {
    composeRunRef.current += 1;
    setScreen("interview");
  };

  const removeIssue = (issueId: string) => {
    deleteInterviewMagazineProjectionEventForIssue(issueId);
    setIssues(deleteInterviewIssue(issueId));
    if (activeIssue?.id === issueId) {
      setActiveIssue(null);
      setScreen("home");
    }
  };

  const removeDraft = (draftId: string) => {
    setDrafts(deleteInterviewDraft(draftId));
    if (activeDraftId === draftId) {
      resetDraft();
      setScreen("home");
    }
  };

  return (
    <div className="interview-app">
      <BackgroundLayer imageUrl={bgImageUrl} />
      <div className="interview-content">
        {screen === "setup" ? (
          <SetupScreen
            characters={characters}
            selectedCharacterIds={selectedCharacterIds}
            userIdentities={userIdentities}
            selectedUserIdentityId={userIdentityId}
            theme={theme}
            programmes={programmes.length ? programmes : BUILTIN_INTERVIEW_PROGRAMMES}
            programmeId={programmeId}
            includeUser={includeUser}
            audienceEnabled={audienceEnabled}
            hostCharacterId={hostCharacterId}
            hostCharacterIds={hostCharacterIds}
            hostOverrides={hostOverrides}
            hostPresetId={hostPresetId}
            onHostPresetChange={setHostPresetId}
            onProgrammeChange={id => { setProgrammeId(id); setHostCharacterId(""); setHostCharacterIds([]); setHostPresetId(BUILTIN_INTERVIEW_HOSTS.find(host => host.programmeId === id)?.id || `host_${id}`); }}
            onProgrammeSave={saveProgramme}
            onProgrammeUpdate={updateProgramme}
            onHostUpdate={updateHost}
            onHostCharacterIdsChange={setHostCharacterIds}
            onProgrammeDelete={removeProgramme}
            onIncludeUserChange={setIncludeUser}
            onAudienceEnabledChange={setAudienceEnabled}
            onHostCharacterChange={setHostCharacterId}
            onThemeChange={setTheme}
            onCharacterToggle={toggleCharacter}
            onUserIdentityChange={setUserIdentityId}
            onBack={() => setScreen("home")}
            onStart={startInterview}
          />
        ) : screen === "interview" ? (
          <InterviewScreen
            theme={theme}
            programmeName={programme.name}
            hostName={selectedHostName}
            hostCharacterId={hostCharacterId}
            includeUser={includeUser}
            audienceEnabled={audienceEnabled}
            characters={activeCharacters}
            messages={messages}
            phase={phase}
            pendingLabel={pendingLabel}
            userInput={userInput}
            error={error}
            canContinue={Boolean(resumeAction)}
            canWrap={messages.some((message) => message.role === "character" || message.role === "user")}
            maxCharacterTurns={maxCharacterTurns}
            scrollRef={scrollRef}
            onUserInputChange={setUserInput}
            onSubmitUserAnswer={submitUserAnswer}
            onSummon={() => void continueInterview()}
            inputMode={inputMode}
            onInputModeChange={setInputMode}
            onContinue={continueInterview}
            onPause={pauseInterview}
            onWrap={composeArticle}
            onAbort={exitInterviewToHome}
          />
        ) : screen === "generating" ? (
          <GeneratingScreen onBack={cancelGenerating} />
        ) : screen === "article" && activeIssue ? (
          <ArticleScreen
            issue={activeIssue}
            onBack={() => {
              setActiveIssue(null);
              resetDraft();
              setScreen("home");
            }}
          />
        ) : (
          <HomeScreen
            issues={issues}
            drafts={drafts}
            onClose={onClose}
            onNewIssue={() => setScreen("setup")}
            onOpenDraft={openDraft}
            onOpenIssue={(issue) => {
              setActiveIssue(issue);
              setScreen("article");
            }}
            onDeleteDraft={removeDraft}
            onDeleteIssue={removeIssue}
          />
        )}
      </div>
    </div>
  );
}

function HomeScreen({
  issues,
  drafts,
  onClose,
  onNewIssue,
  onOpenDraft,
  onOpenIssue,
  onDeleteDraft,
  onDeleteIssue,
}: {
  issues: InterviewIssue[];
  drafts: InterviewDraft[];
  onClose: () => void;
  onNewIssue: () => void;
  onOpenDraft: (draft: InterviewDraft) => void;
  onOpenIssue: (issue: InterviewIssue) => void;
  onDeleteDraft: (draftId: string) => void;
  onDeleteIssue: (issueId: string) => void;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [pendingDeleteDraft, setPendingDeleteDraft] = useState<InterviewDraft | null>(null);
  const [pendingDeleteIssue, setPendingDeleteIssue] = useState<InterviewIssue | null>(null);
  const nextIssueNumber = useMemo(
    () => issues.reduce((largest, issue) => Math.max(largest, issue.issueNumber || 0), 0) + 1,
    [issues],
  );

  return (
    <>
      <header className="interview-header">
        <button className="interview-icon-btn" onClick={onClose} aria-label="返回桌面">
          <ChevronLeft size={20} />
        </button>
        <SmallCaps className="text-white/70 tracking-widest">PRESENCE RADIO</SmallCaps>
        <button className="interview-icon-btn" onClick={() => setArchiveOpen(true)} aria-label="查看往期">
          <Menu size={20} />
        </button>
      </header>

      <main className="interview-scroll px-6 pb-32">
        <section className="text-center py-10 fade-in">
          <div className="flex items-center justify-center gap-4 text-white/40 mb-4">
            <span className="w-10 h-px bg-white/20"></span>
            <SmallCaps>ISSUE NO.{String(nextIssueNumber).padStart(2, "0")}</SmallCaps>
            <span className="w-10 h-px bg-white/20"></span>
          </div>
          <h1 className="font-display text-5xl font-black text-white tracking-wider my-4 drop-shadow-md">
            PRESENCE
          </h1>
          <p className="font-cn text-white/60 tracking-[0.4em] ml-[0.4em] font-light">
            在场 · 电台与播客
          </p>
        </section>

        {drafts.length > 0 && (
          <section className="mt-4 mb-10 fade-in" style={{ animationDelay: '0.05s' }}>
            <div className="flex items-center justify-between mb-4 px-2">
              <SmallCaps className="text-white/60">UNFINISHED // 未完成录制</SmallCaps>
              <span className="text-white/40 text-xs font-serif">{drafts.length} 条</span>
            </div>
            <div className="flex flex-col gap-4">
              {drafts.map((draft) => (
                <article key={draft.id} className="interview-glass-panel interview-glass-panel-hover p-5 relative group overflow-hidden border-white/15">
                  <button type="button" className="w-full text-left" onClick={() => onOpenDraft(draft)}>
                    <div className="flex items-center gap-2 mb-3">
                      <SmallCaps className="text-white/70">{draft.programme?.name || "在场·人物志"} · {getDraftStatusText(draft.status)}</SmallCaps>
                      <span className="text-white/20 text-xs">|</span>
                      <SmallCaps className="text-white/50">{new Date(draft.updatedAt).toLocaleDateString("zh-CN")}</SmallCaps>
                    </div>
                    <h2 className="font-display text-xl font-bold text-white/95 mb-2 leading-tight">
                      {draft.theme}
                    </h2>
                    <p className="font-serif italic text-white/60 text-sm line-clamp-2">
                      {draft.status === "error" ? (draft.error || "API 返回错误，等待继续录制。") : "录制已保存，可从当前位置继续。"}
                    </p>
                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                      <span className="text-white/40 text-xs">GUESTS: {getDraftParticipantText(draft)}</span>
                      <span className="inline-flex items-center gap-1 text-white/50 text-xs">
                        继续 <ChevronRight size={14} />
                      </span>
                    </div>
                  </button>
                  <button
                    className="absolute top-4 right-4 p-2 -m-2 text-white/30 hover:text-red-400/80 active:text-red-500 transition-colors z-10"
                    onClick={(event) => {
                      event.stopPropagation();
                      setPendingDeleteDraft(draft);
                    }}
                    aria-label="删除未完成录制"
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="mt-4 mb-10 fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center justify-between mb-4 px-2">
            <SmallCaps className="text-white/50">ARCHIVES // 往期节目</SmallCaps>
            <span className="text-white/40 text-xs font-serif">{issues.length} 期</span>
          </div>

          {issues.length === 0 ? (
            <div className="interview-glass-panel flex flex-col items-center justify-center p-8 text-center min-h-[140px]">
              <Mic2 size={24} className="text-white/30 mb-3" strokeWidth={1.5} />
              <p className="font-serif italic text-white/40 text-sm">等待第一期节目。</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {issues.map((issue) => (
                <article key={issue.id} className="interview-glass-panel interview-glass-panel-hover p-5 relative group overflow-hidden">
                  <button type="button" className="w-full text-left" onClick={() => onOpenIssue(issue)}>
                    <div className="flex items-center gap-2 mb-3">
                      <SmallCaps className="text-white/60">NO.{String(issue.issueNumber).padStart(2, "0")} · {issue.programme?.name || "在场·人物志"}</SmallCaps>
                      <span className="text-white/20 text-xs">|</span>
                      <SmallCaps className="text-white/60">{issue.theme}</SmallCaps>
                    </div>
                    <h2 className="font-display text-xl font-bold text-white/95 mb-2 leading-tight">
                      {issue.article.title}
                    </h2>
                    <p className="font-serif italic text-white/60 text-sm line-clamp-2">
                      {issue.article.subtitle}
                    </p>
                    <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
                      <span className="text-white/40 text-xs">GUESTS: {getIssueParticipantText(issue)}</span>
                      <ChevronRight size={14} className="text-white/30" />
                    </div>
                  </button>
                  <button
                    className="absolute top-4 right-4 p-2 -m-2 text-white/30 hover:text-red-400/80 active:text-red-500 transition-colors z-10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteIssue(issue);
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>

      <div className="absolute bottom-10 right-6 z-20">
        <button
          className="w-14 h-14 rounded-full flex items-center justify-center bg-white/10 backdrop-blur-md border border-white/20 text-white shadow-lg hover:bg-white/20 hover:scale-105 transition-all"
          onClick={onNewIssue}
        >
          <Plus size={24} strokeWidth={1.5} />
        </button>
      </div>

      {archiveOpen && (
        <>
          <div className="interview-modal-scrim" onClick={() => setArchiveOpen(false)} />
          <div className="interview-drawer">
            <header className="p-6 pb-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <SmallCaps className="text-white/50">ARCHIVES</SmallCaps>
                <div className="text-white/90 font-medium mt-1">往期节目</div>
              </div>
              <button className="interview-icon-btn" onClick={() => setArchiveOpen(false)}>
                <X size={20} />
              </button>
            </header>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {issues.map((issue) => (
                <div key={issue.id} className="interview-glass-panel p-4 flex flex-col gap-2">
                  <button className="text-left w-full" onClick={() => { setArchiveOpen(false); onOpenIssue(issue); }}>
                    <SmallCaps className="text-white/50">NO.{String(issue.issueNumber).padStart(2, "0")} · {issue.theme}</SmallCaps>
                    <h3 className="text-white/90 font-display font-bold mt-1 mb-2">{issue.article.title}</h3>
                    <div className="text-white/40 text-xs">GUESTS // {getIssueParticipantText(issue)}</div>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {pendingDeleteDraft && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="interview-modal-scrim" onClick={() => setPendingDeleteDraft(null)} />
          <div className="interview-glass-panel p-6 w-full max-w-sm relative z-50 fade-in">
            <SmallCaps className="text-red-300/80 mb-2">DELETE DRAFT</SmallCaps>
            <h2 className="text-xl font-medium text-white mb-3">删除未完成录制？</h2>
            <p className="text-white/60 text-sm mb-6 leading-relaxed">
              “{pendingDeleteDraft.theme}” 的录制草稿将被移除。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="px-4 py-2 rounded-full border border-white/10 text-white/70 hover:bg-white/5 text-sm" onClick={() => setPendingDeleteDraft(null)}>取消</button>
              <button className="px-4 py-2 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 text-sm" onClick={() => { onDeleteDraft(pendingDeleteDraft.id); setPendingDeleteDraft(null); }}>删除</button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteIssue && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="interview-modal-scrim" onClick={() => setPendingDeleteIssue(null)} />
          <div className="interview-glass-panel p-6 w-full max-w-sm relative z-50 fade-in">
            <SmallCaps className="text-red-300/80 mb-2">DELETE ISSUE</SmallCaps>
            <h2 className="text-xl font-medium text-white mb-3">删除这期节目？</h2>
            <p className="text-white/60 text-sm mb-6 leading-relaxed">
              《{pendingDeleteIssue.article.title}》将从往期中移除，删除后无法恢复。
            </p>
            <div className="flex gap-3 justify-end">
              <button className="px-4 py-2 rounded-full border border-white/10 text-white/70 hover:bg-white/5 text-sm" onClick={() => setPendingDeleteIssue(null)}>取消</button>
              <button className="px-4 py-2 rounded-full bg-red-500/20 text-red-300 border border-red-500/30 hover:bg-red-500/30 text-sm" onClick={() => { onDeleteIssue(pendingDeleteIssue.id); setPendingDeleteIssue(null); }}>删除</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function SetupScreen({
  characters,
  selectedCharacterIds,
  userIdentities,
  selectedUserIdentityId,
  theme,
  programmes,
  programmeId,
  includeUser,
  audienceEnabled,
  hostCharacterId,
  hostCharacterIds,
  hostOverrides,
  hostPresetId,
  onHostPresetChange,
  onProgrammeChange,
  onProgrammeSave,
  onProgrammeUpdate,
  onHostUpdate,
  onHostCharacterIdsChange,
  onProgrammeDelete,
  onIncludeUserChange,
  onAudienceEnabledChange,
  onHostCharacterChange,
  onThemeChange,
  onCharacterToggle,
  onUserIdentityChange,
  onBack,
  onStart,
}: {
  characters: Character[];
  selectedCharacterIds: string[];
  userIdentities: UserIdentity[];
  selectedUserIdentityId: string;
  theme: string;
  programmes: InterviewProgramme[];
  programmeId: string;
  includeUser: boolean;
  audienceEnabled: boolean;
  hostCharacterId: string;
  hostCharacterIds: string[];
  hostOverrides: InterviewHost[];
  hostPresetId: string;
  onHostPresetChange: (id: string) => void;
  onProgrammeChange: (id: string) => void;
  onProgrammeSave: (name: string, description: string, direction: string, hostRule: InterviewProgramme["hostRule"], characterRadio: boolean, hostStyle: string) => void;
  onProgrammeUpdate: (programme: InterviewProgramme) => void;
  onHostUpdate: (host: InterviewHost) => void;
  onHostCharacterIdsChange: (ids: string[]) => void;
  onProgrammeDelete: (id: string) => void;
  onIncludeUserChange: (enabled: boolean) => void;
  onAudienceEnabledChange: (enabled: boolean) => void;
  onHostCharacterChange: (id: string) => void;
  onThemeChange: (value: string) => void;
  onCharacterToggle: (value: string) => void;
  onUserIdentityChange: (value: string) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const [promptEditorOpen, setPromptEditorOpen] = useState(false);
  const [newProgrammeName, setNewProgrammeName] = useState("");
  const [newProgrammeDescription, setNewProgrammeDescription] = useState("");
  const [newProgrammeDirection, setNewProgrammeDirection] = useState("");
  const [programmeEditorOpen, setProgrammeEditorOpen] = useState(false);
  const [newHostRule, setNewHostRule] = useState<InterviewProgramme["hostRule"]>("optional");
  const [newCharacterRadio, setNewCharacterRadio] = useState(false);
  const [newHostStyle, setNewHostStyle] = useState("");
  const currentProgramme = programmes.find(item => item.id === programmeId) || BUILTIN_INTERVIEW_PROGRAMMES[0];
  const programmeHosts = [...BUILTIN_INTERVIEW_HOSTS, ...(!BUILTIN_INTERVIEW_PROGRAMMES.some(item => item.id === programmeId) ? [{ id: `host_${programmeId}`, programmeId, name: "栏目主持人", language: "韩语", direction: currentProgramme.hostStyle || currentProgramme.direction }] : [])].map(host => hostOverrides.find(override => override.id === host.id) || host).filter(host => host.programmeId === programmeId);
  const currentHost = programmeHosts.find(host => host.id === hostPresetId) || programmeHosts[0];
  const withHost = currentProgramme.hostRule === "required" || (currentProgramme.hostRule !== "none" && hostCharacterId !== "none");
  const guestCount = selectedCharacterIds.length - hostCharacterIds.filter(id => selectedCharacterIds.includes(id)).length;
  const ready = theme.trim().length > 0 && characters.length > 0 && (selectedCharacterIds.length > 0 || includeUser) && (!currentProgramme.characterRadio || (withHost && hostCharacterIds.length > 0)) && (withHost || selectedCharacterIds.length > 0) && (programmeId !== "roundtable" || (withHost ? guestCount + (includeUser ? 1 : 0) >= 2 : selectedCharacterIds.length + (includeUser ? 1 : 0) >= 3));

  return (
    <>
      <header className="interview-header">
        <button className="interview-icon-btn" onClick={onBack}>
          <ChevronLeft size={20} />
        </button>
        <div className="text-center">
          <SmallCaps className="text-white/50">PREP NEW ISSUE</SmallCaps>
          <div className="text-white font-medium">策划新节目</div>
        </div>
        <button className="interview-icon-btn" onClick={() => setPromptEditorOpen(true)} title="编辑当前栏目提示词">
          <PencilLine size={18} />
        </button>
      </header>

      <main className="interview-scroll px-5 py-6 flex flex-col gap-8">
        <section className="fade-in">
          <SmallCaps className="text-white/60">PROGRAMME // 栏目</SmallCaps>
          <div className="flex flex-wrap gap-2 mt-3">
            {programmes.map(item => <button key={item.id} type="button" className={`px-3 py-2 rounded-xl border text-sm ${programmeId === item.id ? "bg-white/20 border-white/60 text-white" : "border-white/15 text-white/60"}`} onClick={() => onProgrammeChange(item.id)} title={item.direction}>{item.name}</button>)}
            <button type="button" className="px-3 py-2 rounded-xl border border-dashed border-white/30 text-sm text-white/70" onClick={() => setProgrammeEditorOpen(value => !value)}>＋ 自建栏目</button>
          </div>
          <p className="text-xs text-white/50 mt-2">{programmes.find(item => item.id === programmeId)?.description}</p>
          {programmeEditorOpen && <div className="interview-glass-panel p-4 mt-3 flex flex-col gap-2">
            <input className="interview-glass-input p-2" placeholder="栏目名称" value={newProgrammeName} onChange={e => setNewProgrammeName(e.target.value)} />
            <input className="interview-glass-input p-2" placeholder="一句话介绍" value={newProgrammeDescription} onChange={e => setNewProgrammeDescription(e.target.value)} />
            <textarea className="interview-glass-input p-2" placeholder="主持风格、节目形式与节奏" value={newProgrammeDirection} onChange={e => setNewProgrammeDirection(e.target.value)} />
            <label className="text-xs text-white/70">主持方式<select className="interview-glass-input p-2 block w-full mt-1" value={newHostRule} onChange={e => setNewHostRule(e.target.value as InterviewProgramme["hostRule"])}><option value="required">必须有主持</option><option value="optional">开播前选择有无主持</option><option value="none">没有主持</option></select></label>
            <label className="text-xs text-white/70 flex items-center gap-2"><input type="checkbox" checked={newCharacterRadio} onChange={e => { setNewCharacterRadio(e.target.checked); if (e.target.checked) setNewHostRule("required"); }} />创建角色自己的电台（角色当主持人，可选多位）</label>
            <input className="interview-glass-input p-2" placeholder="角色主持风格补充（可不填，默认按人设）" value={newHostStyle} onChange={e => setNewHostStyle(e.target.value)} />
            <button type="button" className="text-white/90 text-sm self-end" disabled={!newProgrammeName.trim() || !newProgrammeDirection.trim()} onClick={() => { onProgrammeSave(newProgrammeName, newProgrammeDescription, newProgrammeDirection, newCharacterRadio ? "required" : newHostRule, newCharacterRadio, newHostStyle); setProgrammeEditorOpen(false); setNewProgrammeName(""); setNewProgrammeDescription(""); setNewProgrammeDirection(""); }}>保存栏目</button>
          </div>}
          {programmeId.startsWith("programme_") && <button type="button" className="text-xs text-white/40 mt-2" onClick={() => onProgrammeDelete(programmeId)}>删除此自建栏目</button>}
        </section>
        <section className="fade-in flex flex-col gap-3">
          <SmallCaps className="text-white/60">HOST // 主持方式</SmallCaps>
          <select className="interview-glass-input p-3" value={currentProgramme.hostRule === "none" || currentProgramme.hostRule === "optional" && hostCharacterId === "none" ? "none" : hostCharacterId && hostCharacterId !== "none" ? `character:${hostCharacterId}` : currentProgramme.characterRadio ? "" : `preset:${currentHost?.id || hostPresetId}`} onChange={e => { if (e.target.value === "none") { onHostCharacterChange("none"); onHostCharacterIdsChange([]); return; } const [type, id] = e.target.value.split(":"); if (type === "character") { onHostCharacterChange(id); onHostCharacterIdsChange([id]); } else { onHostCharacterChange(""); onHostCharacterIdsChange([]); onHostPresetChange(id); } }}>
            {currentProgramme.characterRadio && <option value="">选择角色主持人</option>}
            {currentProgramme.hostRule === "none" && <option value="none">本栏目无主持人</option>}
            {currentProgramme.hostRule === "optional" && <option value="none">本场无主持人</option>}
            {!currentProgramme.characterRadio && currentProgramme.hostRule !== "none" && programmeHosts.map(item => <option key={item.id} value={`preset:${item.id}`}>{item.name} · {item.language}</option>)}
            {currentProgramme.hostRule !== "none" && characters.filter(item => selectedCharacterIds.includes(item.id)).map(item => <option key={item.id} value={`character:${item.id}`}>{item.name} · 自己开播</option>)}
          </select>
          {currentProgramme.characterRadio && <div className="interview-glass-panel p-3 text-sm text-white/75">选本期角色主持人（至少一位）：<div className="flex flex-wrap gap-2 mt-2">{characters.filter(item => selectedCharacterIds.includes(item.id)).map(item => <label key={item.id} className="flex items-center gap-1"><input type="checkbox" checked={hostCharacterIds.includes(item.id)} onChange={e => { const ids = e.target.checked ? [...hostCharacterIds, item.id] : hostCharacterIds.filter(id => id !== item.id); onHostCharacterIdsChange(ids); onHostCharacterChange(ids[0] || ""); }} />{item.name}</label>)}</div></div>}
          {withHost && !hostCharacterId && currentHost && <details className="text-xs text-white/60"><summary className="cursor-pointer">编辑本栏目主持人 · {currentHost.name}</summary><div className="flex flex-col gap-2 mt-3"><input className="interview-glass-input p-2" aria-label="主持人名字" value={currentHost.name} onChange={e => onHostUpdate({ ...currentHost, name: e.target.value })} /><input className="interview-glass-input p-2" aria-label="主持人语言" value={currentHost.language} onChange={e => onHostUpdate({ ...currentHost, language: e.target.value })} /><textarea className="interview-glass-input p-2 min-h-28" aria-label="主持人风格" value={currentHost.direction} onChange={e => onHostUpdate({ ...currentHost, direction: e.target.value })} /></div></details>}
          <label className="text-sm text-white/80 flex items-center gap-2"><input type="checkbox" checked={includeUser} onChange={e => onIncludeUserChange(e.target.checked)} />邀请用户参与录制</label>
          <label className="text-sm text-white/80 flex items-center gap-2"><input type="checkbox" checked={audienceEnabled} onChange={e => onAudienceEnabledChange(e.target.checked)} />模拟听众弹幕与评论（每轮 0–5 条）</label>
          {programmeId === "roundtable" && <p className="text-xs text-white/55">日月闲至少三人：有主持人时另需两位嘉宾（角色或用户）；无主持人时三位参与者。</p>}
        </section>
        <section className="fade-in">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white/30 text-xs font-mono">01</span>
            <SmallCaps className="text-white/60">VOICES // 参与角色</SmallCaps>
          </div>
          <div className="flex flex-col gap-3">
            {characters.map((character) => {
              const active = selectedCharacterIds.includes(character.id);
              return (
                <button
                  key={character.id}
                  className={`interview-glass-panel p-4 text-left transition-all ${active ? 'border-white/70 bg-white/[0.13] shadow-[0_0_0_1px_rgba(255,255,255,0.28),0_6px_22px_rgba(255,255,255,0.07)]' : 'opacity-60 hover:opacity-100'}`}
                  onClick={() => onCharacterToggle(character.id)}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-base font-medium text-white">{character.name}</span>
                    <SmallCaps className={active ? "text-white tracking-[0.18em]" : "text-white/40"}>
                      {active ? "● SELECTED" : "TAP TO SELECT"}
                    </SmallCaps>
                  </div>
                  <p className="text-xs text-white/50 line-clamp-1">{character.personality || character.persona || "嘉宾"}</p>
                </button>
              );
            })}
          </div>
        </section>

        {includeUser && <section className="fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white/30 text-xs font-mono">02</span>
            <SmallCaps className="text-white/60">用户 // 参与身份</SmallCaps>
          </div>
          <select
            className="interview-glass-input w-full px-4 py-3 appearance-none focus:outline-none"
            value={selectedUserIdentityId}
            onChange={(e) => onUserIdentityChange(e.target.value)}
          >
            {userIdentities.length === 0 ? (
              <option value="" className="bg-stone-900">未绑定身份</option>
            ) : userIdentities.map((id) => (
              <option key={id.id} value={id.id} className="bg-stone-900 text-white">{id.name}</option>
            ))}
          </select>
        </section>}

        <section className="fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="flex items-center gap-3 mb-4">
            <span className="text-white/30 text-xs font-mono">03</span>
            <SmallCaps className="text-white/60">THEME // 本期主题</SmallCaps>
          </div>
          <input
            className="interview-glass-input w-full px-5 py-4 text-lg mb-4"
            value={theme}
            onChange={(e) => onThemeChange(e.target.value)}
            placeholder="输入本期话题..."
          />
          <div className="flex flex-wrap gap-2">
            {THEME_CHIPS.map(chip => {
              const chipActive = theme === chip;
              return (
                <button
                  key={chip}
                  className={`px-3 py-1.5 rounded-full border text-sm transition-colors ${chipActive ? 'border-white/70 bg-white/15 text-white shadow-[0_0_0_1px_rgba(255,255,255,0.25)]' : 'border-white/10 text-white/60 hover:bg-white/10 hover:text-white'}`}
                  onClick={() => onThemeChange(chip)}
                >
                  {chip}
                </button>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="interview-bottom-bar">
        <button
          className="interview-primary-btn w-full"
          disabled={!ready}
          onClick={onStart}
        >
          <Radio size={16} className={ready ? "text-white" : "text-white/40"} />
          <span className={ready ? "text-white font-medium" : "text-white/40"}>BEGIN RECORDING // 开始录制</span>
        </button>
      </footer>

      {promptEditorOpen && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
          <div className="interview-modal-scrim" onClick={() => setPromptEditorOpen(false)} />
          <div className="relative w-full max-w-lg h-[75vh] interview-glass-panel p-6 flex flex-col z-50 fade-in bg-[#111]/80">
            <header className="flex justify-between items-center mb-6">
              <div>
                <SmallCaps className="text-white/50">EDITOR PROMPTS</SmallCaps>
                <div className="text-white text-lg mt-1">{currentProgramme.name} · 提示词</div>
              </div>
              <button className="interview-icon-btn" onClick={() => setPromptEditorOpen(false)}><X size={20} /></button>
            </header>
            <div className="flex-1 overflow-y-auto flex flex-col gap-6">
              <div className="flex flex-col flex-1">
                <SmallCaps className="text-white/50 mb-2 block flex-shrink-0">PROGRAMME // 名称与简介</SmallCaps>
                <input className="interview-glass-input p-2 mb-2" value={currentProgramme.name} onChange={e => onProgrammeUpdate({ ...currentProgramme, name: e.target.value })} />
                <input className="interview-glass-input p-2 mb-2" value={currentProgramme.description} onChange={e => onProgrammeUpdate({ ...currentProgramme, description: e.target.value })} />
                <textarea className="interview-glass-input p-2 mb-2 min-h-20" value={currentProgramme.direction} onChange={e => onProgrammeUpdate({ ...currentProgramme, direction: e.target.value })} />
                <SmallCaps className="text-white/50 mb-2 block flex-shrink-0">HOST STYLE // 主持风格补充（可留空）</SmallCaps>
                <textarea className="interview-glass-input p-2 mb-2 min-h-16" value={currentProgramme.hostStyle || ""} onChange={e => onProgrammeUpdate({ ...currentProgramme, hostStyle: e.target.value })} />
                <SmallCaps className="text-white/50 mb-2 block flex-shrink-0">HOST PROMPT // 本栏目提示词</SmallCaps>
                <textarea
                  className="interview-glass-panel !rounded-xl focus:bg-white/[0.08] focus:border-white/25 focus:outline-none transition-all w-full p-4 flex-1 resize-none text-[calc(11px*var(--app-text-scale,1))] leading-relaxed"
                  value={currentProgramme.hostPrompt || ""}
                  onChange={(e) => onProgrammeUpdate({ ...currentProgramme, hostPrompt: e.target.value })}
                />
              </div>
              <div className="flex flex-col flex-1">
                <SmallCaps className="text-white/50 mb-2 block flex-shrink-0">MEMORY // 短期记忆</SmallCaps>
                <textarea
                  className="interview-glass-panel !rounded-xl focus:bg-white/[0.08] focus:border-white/25 focus:outline-none transition-all w-full p-4 flex-1 resize-none text-[calc(11px*var(--app-text-scale,1))] leading-relaxed"
                  value={currentProgramme.memoryPrompt || ""}
                  onChange={(e) => onProgrammeUpdate({ ...currentProgramme, memoryPrompt: e.target.value })}
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-white/10">
              <button className="px-5 py-2.5 rounded-full border border-white/10 text-white/70 text-sm" onClick={() => setPromptEditorOpen(false)}>关闭</button>
              <button className="px-5 py-2.5 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium" onClick={() => setPromptEditorOpen(false)}>完成</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function InterviewScreen({
  theme,
  programmeName,
  hostName,
  hostCharacterId,
  includeUser,
  audienceEnabled,
  characters,
  messages,
  phase,
  pendingLabel,
  userInput,
  error,
  canContinue,
  canWrap,
  maxCharacterTurns,
  scrollRef,
  onUserInputChange,
  onSubmitUserAnswer,
  onSummon,
  inputMode,
  onInputModeChange,
  onContinue,
  onPause,
  onWrap,
  onAbort,
}: {
  theme: string;
  programmeName: string;
  hostName: string;
  hostCharacterId: string;
  includeUser: boolean;
  audienceEnabled: boolean;
  characters: Character[];
  messages: InterviewMessage[];
  phase: InterviewPhase;
  pendingLabel: string;
  userInput: string;
  error: string;
  canContinue: boolean;
  canWrap: boolean;
  maxCharacterTurns: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  onUserInputChange: (value: string) => void;
  onSubmitUserAnswer: () => void;
  onSummon: () => void;
  inputMode: "speech" | "barrage" | "direction";
  onInputModeChange: (mode: "speech" | "barrage" | "direction") => void;
  onContinue: () => void;
  onPause: () => void;
  onWrap: () => void;
  onAbort: () => void;
}) {
  const characterNameById = useMemo(
    () => Object.fromEntries(characters.map((c) => [c.id, c.name])),
    [characters],
  );
  const guestLabel = [characters.map(c => c.name).join("、"), includeUser ? "用户" : ""].filter(Boolean).join("、") || "嘉宾";
  const turns = messages.filter(m => m.role === 'character').length;

  return (
    <>
      <header className="interview-header backdrop-blur-md bg-black/20">
        <button className="interview-icon-btn" onClick={onAbort}>
          <X size={20} />
        </button>
        <div className="flex flex-col items-center">
          <SmallCaps className="text-white/60 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></span>
            ON AIR // 录制中
          </SmallCaps>
          <div className="text-white text-xs opacity-50 font-mono mt-1">ROUND {turns}/{maxCharacterTurns}</div>
        </div>
        <div className="w-10"></div>
      </header>

      <main className="interview-scroll px-4 pt-6 pb-32 scroll-smooth" ref={scrollRef}>
        <div className="text-center mb-10 fade-in">
          <SmallCaps className="text-white/40">{programmeName} // 本期</SmallCaps>
          <h2 className="text-2xl text-white/90 font-bold mt-2 mb-2">{theme}</h2>
          <div className="text-xs text-white/30 font-mono">主持：{hostName} · 参与：{guestLabel}</div>
          <div className="w-12 h-px bg-white/20 mx-auto mt-6"></div>
        </div>

        <div className="flex flex-col gap-6">
          {messages.map((message) => {
            const isHost = message.role === "host";
            const isSpecial = message.kind === "intro" || message.kind === "outro";
            const speakerName = message.speakerName || (message.speakerCharacterId ? characterNameById[message.speakerCharacterId] : null) || guestLabel;

            if (message.role === "audience") return null;
            if (message.role === "direction") return <div key={message.id} className="interview-director-hint">幕后提示 · {message.content}</div>;

            if (isHost) {
              return (
                <div key={message.id} className="py-6 my-2 border-y border-white/5 bg-gradient-to-r from-transparent via-white/[0.03] to-transparent flex flex-col items-center text-center">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="w-1.5 h-1.5 bg-white/30 rotate-45"></span>
                    <SmallCaps className="text-white/40 tracking-widest">HOST // {message.speakerName || hostName}</SmallCaps>
                    <span className="w-1.5 h-1.5 bg-white/30 rotate-45"></span>
                  </div>
                  <p className={`text-[calc(16px*var(--app-text-scale,1))] leading-relaxed max-w-[90%] mx-auto ${isSpecial ? 'text-white/50 italic font-serif' : 'text-white/80 font-medium'}`}>
                    <InterviewBilingualAnswer text={message.content} />
                  </p>
                  {message.kind === "question" && (
                    <div className="mt-4 text-[calc(11px*var(--app-text-scale,1))] font-mono text-white/30 border border-white/10 rounded-full px-3 py-1 flex items-center gap-2">
                      <span className="w-1 h-1 rounded-full bg-white/30"></span>
                      提问对象 ▹ {message.target === "user" ? "用户" : message.targetCharacterName || "嘉宾"}
                    </div>
                  )}
                </div>
              );
            }

            const isUser = message.role === "user";

            return (
              <div key={message.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                <div className={`interview-glass-panel p-4 max-w-[85%] ${isUser ? 'bg-white/10 border-white/20' : 'bg-white/5 border-white/10'}`}>
                  <SmallCaps className={`mb-1 flex items-center ${isUser ? 'text-white/40 justify-end' : 'text-white/60'}`}>
                    {isUser ? '用户 // 共同受访' : `[ ${speakerName.toUpperCase()} ]`}
                    {!isUser && <InterviewVoiceButton text={message.content} characterId={message.speakerCharacterId} />}
                  </SmallCaps>
                  <p className="text-[calc(15px*var(--app-text-scale,1))] leading-relaxed text-white/90 whitespace-pre-wrap">
                    {isUser ? message.content : <InterviewBilingualAnswer text={message.content} />}
                  </p>
                </div>
              </div>
            );
          })}

          {(phase === "opening" || phase === "host" || phase === "character") && (
            <div className="interview-typing flex items-center gap-3 py-4 text-white/40 text-sm">
              <span className="font-mono text-xs">{pendingLabel || "WAITING"}</span>
              <span><i></i><i></i><i></i></span>
            </div>
          )}

          {phase === "paused" && (
            <div className="interview-glass-panel p-4 bg-white/10 border-white/20 text-white/80">
              <div className="font-bold text-sm mb-1">PAUSED // 录制已暂停</div>
              <p className="text-xs opacity-70">点击下方继续按钮，从中断位置接着录制。</p>
            </div>
          )}

          {phase === "error" && (
            <div className="interview-glass-panel p-4 bg-red-900/30 border-red-500/30 text-red-200">
              <div className="font-bold text-sm mb-1">INTERRUPTED // 录制中断</div>
              <p className="text-xs opacity-80">{error}</p>
            </div>
          )}
        </div>
      </main>

      {<div className="interview-danmaku-layer" aria-label="实时弹幕">
        {messages.filter(message => message.role === "audience").slice(-5).map((message, index) => <span key={message.id} className="interview-danmaku" style={{ top: `${12 + index * 16}%`, animationDuration: `${9 + index * 1.4}s` }}>匿名 · {message.content}</span>)}
      </div>}

      <footer className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black via-black/80 to-transparent">
        {phase === "user" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-xs text-white/60 px-2"><label>发送方式 <select className="bg-black/70 border border-white/20 rounded-lg px-2 py-1 text-white" value={!includeUser && inputMode === "speech" ? "barrage" : inputMode} onChange={e => onInputModeChange(e.target.value as "speech" | "barrage" | "direction")}>{includeUser && <option value="speech">发言</option>}<option value="barrage">发弹幕（匿名）</option><option value="direction">发指令（幕后）</option></select></label><button type="button" className="px-3 py-1.5 rounded-full border border-white/20 text-white/80" onClick={onSummon}>召唤下一段 ›</button></div>
            <div className="interview-glass-input rounded-full p-1.5 flex items-center bg-black/40 border-white/15">
              <textarea
                className="flex-1 bg-transparent border-none text-white text-[calc(15px*var(--app-text-scale,1))] px-4 py-2 max-h-24 resize-none focus:outline-none focus:ring-0 placeholder-white/30"
                rows={1}
                value={userInput}
                onChange={(e) => onUserInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (userInput.trim()) onSubmitUserAnswer(); else onSummon();
                  }
                }}
                placeholder={inputMode === "direction" ? "幕后引导下一话题；空回车推进" : includeUser && inputMode === "speech" ? "可以连续发言；空回车召唤" : "匿名弹幕；空回车召唤"}
              />
              <button
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all flex-shrink-0 ${userInput.trim() ? 'bg-white text-black' : 'bg-white/10 text-white/30'}`}
                disabled={!userInput.trim()}
                onClick={onSubmitUserAnswer}
              >
                <Send size={16} className={userInput.trim() ? "ml-0.5" : ""} />
              </button>
            </div>
            {canWrap && (
              <button className="text-xs font-mono text-white/40 hover:text-white/80 py-1 text-center transition-colors" onClick={onWrap}>
                [ 提前结束并保存 // WRAP NOW ]
              </button>
            )}
          </div>
        ) : phase === "done" ? (
          <button className="interview-primary-btn w-full bg-white text-black border-transparent shadow-[0_0_20px_rgba(255,255,255,0.3)]" onClick={onWrap}>
            <Sparkles size={16} />
            <span className="font-bold">保存本期并生成回顾</span>
          </button>
        ) : phase === "paused" ? (
          <div className="flex flex-col gap-3">
            <button className="interview-primary-btn w-full bg-white text-black border-transparent shadow-[0_0_20px_rgba(255,255,255,0.22)]" onClick={onContinue}>
              <Radio size={16} />
              <span className="font-bold">继续录制 // CONTINUE</span>
            </button>
            {canWrap ? (
              <button className="text-xs font-mono text-white/40 hover:text-white/80 py-1 text-center transition-colors" onClick={onWrap}>
                [ 保存当前实录并生成回顾 ]
              </button>
            ) : null}
          </div>
        ) : phase === "error" ? (
          <div className="flex flex-col gap-3">
            {canContinue ? (
              <button className="interview-primary-btn w-full bg-white text-black border-transparent shadow-[0_0_20px_rgba(255,255,255,0.22)]" onClick={onContinue}>
                <Radio size={16} />
                <span className="font-bold">继续录制 // CONTINUE</span>
              </button>
            ) : null}
            {canWrap ? (
              <button className="interview-primary-btn w-full bg-red-500/20 text-red-100 border-red-500/30" onClick={onWrap}>
                <span>保存实录并生成回顾</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="h-14 flex items-center justify-center">
            <button
              className="interview-pulse-glow w-14 h-14 rounded-full flex items-center justify-center bg-white/10 border border-white/20 text-white/70 backdrop-blur-md transition-all active:scale-95"
              onClick={onPause}
              aria-label="暂停录制"
              title="暂停录制"
            >
              <Pause size={18} />
            </button>
          </div>
        )}
      </footer>
    </>
  );
}

function GeneratingScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-2xl">
      <div className="flex flex-col items-center text-center fade-in relative z-50 p-8 interview-glass-panel w-4/5 max-w-sm">
        <Loader2 size={32} className="interview-spin text-white/80 mb-6" />
        <SmallCaps className="text-white/40 mb-2">COMPOSING EPISODE</SmallCaps>
        <div className="font-display text-2xl text-white font-bold tracking-widest mb-2">整理节目</div>
        <p className="text-white/50 text-sm">正在整理节目回顾，请稍候...</p>
        <button className="mt-8 text-white/30 text-xs font-mono hover:text-white/60 transition-colors" onClick={onBack}>
          [ CANCEL // 取消 ]
        </button>
      </div>
    </div>
  );
}

function ArticleScreen({
  issue,
  onBack,
}: {
  issue: InterviewIssue;
  onBack: () => void;
}) {
  const guestNames = getIssueGuestNames(issue);
  const guestLabel = guestNames.join("、") || issue.characterName;

  return (
    <div className="absolute inset-0 bg-[#0a0a0a] z-40 overflow-hidden flex flex-col">
      <header className="interview-header bg-black/50 backdrop-blur-md absolute top-0 left-0 right-0 z-10">
        <button className="w-10 h-10 flex items-center justify-center text-white/60 hover:text-white transition-colors" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <SmallCaps className="text-white/40 tracking-widest">ISSUE NO.{String(issue.issueNumber).padStart(2, "0")}</SmallCaps>
        <div className="w-10"></div>
      </header>

      <main className="flex-1 overflow-y-auto px-6 pt-24 pb-32">
        <article className="max-w-2xl mx-auto">
          <div className="text-center mb-12 fade-in">
            <SmallCaps className="text-white/30 mb-6 block">PRESENCE // {issue.programme?.name || "人物特写"}</SmallCaps>
            <h1 className="font-display text-3xl md:text-4xl text-white/95 font-bold leading-tight mb-4">
              {issue.article.title}
            </h1>
            <p className="font-serif italic text-white/60 text-lg mb-8">
              {issue.article.subtitle}
            </p>
            <div className="flex items-center justify-center gap-3">
              <span className="w-8 h-px bg-white/20"></span>
              <span className="text-white/40 text-xs font-mono tracking-widest">GUEST: {guestLabel}</span>
              <span className="w-8 h-px bg-white/20"></span>
            </div>
          </div>

          <div className="space-y-6 text-white/80 font-cn text-[calc(15px*var(--app-text-scale,1))] leading-loose fade-in" style={{ animationDelay: '0.2s' }}>
            {issue.article.body.map((p, i) => (
              <p key={i} className={i === 0 ? "first-letter:text-4xl first-letter:font-display first-letter:float-left first-letter:mr-2 first-letter:text-white" : ""}>
                {p}
              </p>
            ))}
          </div>

          {issue.article.pullQuote && (
            <div className="my-14 py-8 border-y border-white/10 text-center relative">
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 bg-[#0a0a0a] px-4 text-white/20 text-2xl font-serif">"</span>
              <p className="font-serif italic text-white/90 text-xl leading-relaxed">
                <InterviewBilingualAnswer text={issue.article.pullQuote} />
              </p>
              <SmallCaps className="text-white/40 mt-6 block">— {issue.characterName}</SmallCaps>
            </div>
          )}

          {issue.article.qa.length > 0 && (
            <div className="mt-16">
              <div className="flex items-center gap-4 mb-8">
                <h2 className="font-display italic text-2xl text-white/90">Q&A</h2>
                <div className="flex-1 h-px bg-white/10"></div>
                <SmallCaps className="text-white/30">PRECISION CUTS</SmallCaps>
              </div>
              <div className="space-y-8">
                {issue.article.qa.map((qa, i) => (
                  <div key={i} className="interview-glass-panel p-6 border-white/5 bg-white/[0.02]">
                    <div className="flex gap-4 mb-3">
                      <span className="font-display font-bold text-white/60">Q.</span>
                      <p className="text-white/90 font-medium leading-relaxed">{qa.q}</p>
                    </div>
                    <div className="flex gap-4">
                      <span className="font-display italic text-white/40">A.</span>
                      <p className="text-white/70 leading-relaxed"><InterviewBilingualAnswer text={qa.a} /></p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-16 pt-8 border-t border-white/5">
            <SmallCaps className="text-white/30 mb-4 block">TRANSCRIPT // 原始访谈实录</SmallCaps>
            <details className="group">
              <summary className="text-white/40 text-sm font-mono hover:text-white/70 transition-colors cursor-pointer flex items-center gap-2 outline-none select-none">
                <ChevronRight size={16} className="group-open:rotate-90 transition-transform" />
                [ VIEW FULL TRANSCRIPT ]
              </summary>
              <div className="mt-6 p-5 interview-glass-panel bg-white/[0.02] border-white/5 flex flex-col gap-5">
                {issue.transcript.filter(message => message.role !== "audience" && message.role !== "direction").map(message => <div key={message.id} className="text-white/70 text-sm leading-relaxed">
                  <small className="text-white/35 flex items-center mb-1">{message.role === "host" ? message.speakerName || INTERVIEW_MAGAZINE_HOST_NAME : message.role === "user" ? issue.userName : message.speakerName || issue.characterName}{message.role === "character" && <InterviewVoiceButton text={message.content} characterId={message.speakerCharacterId} />}</small>
                  <InterviewBilingualAnswer text={message.content} />
                </div>)}
              </div>
            </details>
          </div>

          {issue.transcript.some(message => message.role === "audience" && (issue.audienceEnabled !== false || message.audienceSource === "user")) && <section className="mt-12 pt-8 border-t border-white/10">
            <SmallCaps className="text-white/50 block mb-4">LISTENERS // 听众评论</SmallCaps>
            <div className="flex flex-col gap-3">{issue.transcript.filter(message => message.role === "audience" && (issue.audienceEnabled !== false || message.audienceSource === "user")).map(message => <p className="interview-audience-comment" key={message.id}><strong>匿名</strong> {message.content}</p>)}</div>
          </section>}

          <div className="mt-20 pt-8 border-t border-white/10 text-center">
            <SmallCaps className="text-white/30 block mb-2">END // 完</SmallCaps>
            <div className="text-white/20 text-xs font-mono">{new Date(issue.createdAt).toLocaleDateString("en-US")}</div>
          </div>
        </article>
      </main>
    </div>
  );
}

export default InterviewMagazineApp;
