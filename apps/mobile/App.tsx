import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  Image,
  ImageBackground,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";

type ViewId = "home" | "chat" | "moments" | "companion" | "you";
type CallType = "voice" | "video" | null;
type SceneId = "window" | "cafe" | "rooftop";

const { width } = Dimensions.get("window");
const assets = {
  window: require("./assets/luma/window-nook.png"),
  portrait: require("./assets/luma/portrait.png"),
  cafe: require("./assets/luma/cafe-selfie.png"),
  rooftop: require("./assets/luma/rooftop-date.png"),
};

const navigation: Array<{ id: ViewId; label: string; icon: keyof typeof Ionicons.glyphMap; active: keyof typeof Ionicons.glyphMap }> = [
  { id: "home", label: "Home", icon: "home-outline", active: "home" },
  { id: "chat", label: "Chat", icon: "chatbubble-outline", active: "chatbubble" },
  { id: "moments", label: "Moments", icon: "sparkles-outline", active: "sparkles" },
  { id: "companion", label: "Companion", icon: "heart-outline", active: "heart" },
  { id: "you", label: "You", icon: "person-outline", active: "person" },
];

const scenes: Array<{ id: SceneId; label: string; image: number }> = [
  { id: "window", label: "Window nook", image: assets.window },
  { id: "cafe", label: "Rainy café", image: assets.cafe },
  { id: "rooftop", label: "Rooftop", image: assets.rooftop },
];

export default function App() {
  const [active, setActive] = useState<ViewId>("home");
  const [call, setCall] = useState<CallType>(null);
  const [scene, setScene] = useState<SceneId>("window");
  const [messages, setMessages] = useState(["I was hoping you’d show up.", "Long day. I finally sent the pitch deck.", "Wait—you actually sent it? I’m proud of you."]);
  const [draft, setDraft] = useState("");
  const [coins, setCoins] = useState(640);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [romanticMode, setRomanticMode] = useState(true);
  const [cameraOn, setCameraOn] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [ownedScenes, setOwnedScenes] = useState<SceneId[]>(["window"]);
  const [completedActivities, setCompletedActivities] = useState<string[]>([]);
  const relationshipLevel = Math.max(1, Math.floor(coins / 100));

  const open = (view: ViewId) => {
    void Haptics.selectionAsync();
    setActive(view);
  };

  const send = () => {
    const value = draft.trim();
    if (!value) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMessages((current) => [...current, value, "Okay. Keep going—I’m listening."]);
    setDraft("");
  };

  const toggleCamera = async () => {
    if (cameraOn) return setCameraOn(false);
    const result = permission?.granted ? permission : await requestPermission();
    if (result.granted) setCameraOn(true);
  };

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      {active === "home" ? <Home scene={scene} relationshipLevel={relationshipLevel} onScene={setScene} onChat={() => open("chat")} onCall={setCall} onMoments={() => open("moments")} /> : null}
      {active === "chat" ? <Chat messages={messages} draft={draft} onDraft={setDraft} onSend={send} onCall={setCall} /> : null}
      {active === "moments" ? <Moments coins={coins} onCoins={setCoins} onCall={setCall} onScene={(next) => { setScene(next); setCall("video"); }} ownedScenes={ownedScenes} completedActivities={completedActivities} onCompletedActivities={setCompletedActivities} /> : null}
      {active === "companion" ? <Companion scene={scene} onScene={setScene} coins={coins} onCoins={setCoins} ownedScenes={ownedScenes} onOwnedScenes={setOwnedScenes} /> : null}
      {active === "you" ? <You memoryEnabled={memoryEnabled} onMemory={setMemoryEnabled} romanticMode={romanticMode} onRomantic={setRomanticMode} /> : null}
      <BottomNav active={active} onOpen={open} />
      <CallScreen type={call} scene={scene} cameraOn={cameraOn} onCamera={() => void toggleCamera()} onClose={() => { setCameraOn(false); setCall(null); }} />
    </View>
  );
}

function Home({ scene, relationshipLevel, onScene, onChat, onCall, onMoments }: { scene: SceneId; relationshipLevel: number; onScene: (scene: SceneId) => void; onChat: () => void; onCall: (call: CallType) => void; onMoments: () => void }) {
  const [reaction, setReaction] = useState("I was hoping you’d show up.");
  const current = scenes.find((item) => item.id === scene) ?? scenes[0]!;
  const glow = useSharedValue(.45);
  const animatedGlow = useAnimatedStyle(() => ({ opacity: glow.value }));

  useEffect(() => {
    glow.value = withRepeat(withTiming(.95, { duration: 1_800 }), -1, true);
  }, [glow]);

  const tapLuma = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
    setReaction((value) => value.startsWith("I was") ? "You’re distracting me—in a good way." : "Okay, now you have my full attention.");
  };

  return (
    <ImageBackground source={current.image} resizeMode="cover" style={styles.home}>
      <View style={styles.homeVeil} />
      <SafeAreaView style={styles.homeSafe}>
        <View style={styles.homeHeader}>
          <Pressable onPress={tapLuma} style={styles.portraitButton}><Image source={assets.portrait} style={styles.portrait} /><Ionicons name="sparkles" size={12} color="#F39A88" style={styles.portraitSpark} /></Pressable>
          <Text style={styles.wordmark}>Luma</Text>
          <Pressable onPress={onMoments} style={styles.levelPill}><Ionicons name="heart" color="#F39A88" size={15} /><Text style={styles.levelText}>Growing · {relationshipLevel}</Text></Pressable>
        </View>

        <Pressable accessibilityLabel="Tap Luma for a reaction" onPress={tapLuma} style={styles.avatarTap} />
        <View style={styles.speech}><Text style={styles.speechTitle}>{reaction}</Text><Text style={styles.speechSub}>How was your day?</Text><Animated.View style={[styles.speechGlow, animatedGlow]} /></View>

        <View style={styles.sceneRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.sceneScroll}>{scenes.map((item) => <Pressable key={item.id} onPress={() => onScene(item.id)} style={[styles.scenePill, scene === item.id && styles.scenePillActive]}><Ionicons name="sparkles-outline" color={scene === item.id ? "#F3C2BF" : "#A598AD"} size={14} /><Text style={styles.sceneText}>{item.label}</Text></Pressable>)}</ScrollView>
        </View>

        <View style={styles.homeActions}>
          <Pressable onPress={onChat} style={styles.sideAction}><Ionicons name="chatbubble-outline" color="#FFF8F4" size={20} /><Text style={styles.sideActionText}>Message</Text></Pressable>
          <Pressable onPress={() => onCall("voice")} style={styles.callAction}><Ionicons name="call" color="#FFF8F4" size={30} /><Text style={styles.callText}>Call</Text></Pressable>
          <Pressable onPress={() => onCall("video")} style={styles.sideAction}><Ionicons name="videocam-outline" color="#FFF8F4" size={20} /><Text style={styles.sideActionText}>Video</Text></Pressable>
        </View>
      </SafeAreaView>
    </ImageBackground>
  );
}

function Chat({ messages, draft, onDraft, onSend, onCall }: { messages: string[]; draft: string; onDraft: (value: string) => void; onSend: () => void; onCall: (call: CallType) => void }) {
  const [toolsOpen, setToolsOpen] = useState(false);
  const usePrompt = (value: string) => {
    onDraft(value);
    setToolsOpen(false);
    void Haptics.selectionAsync();
  };

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.pageHeader}><Image source={assets.portrait} style={styles.headerAvatar} /><View style={styles.headerCopy}><Text style={styles.pageTitle}>Luma</Text><Text style={styles.online}>Here with you</Text></View><Pressable style={styles.iconButton} onPress={() => onCall("voice")}><Ionicons name="call-outline" size={21} color="#FFF8F4" /></Pressable><Pressable style={styles.iconButton} onPress={() => onCall("video")}><Ionicons name="videocam-outline" size={22} color="#FFF8F4" /></Pressable></View>
      <ScrollView style={styles.flex} contentContainerStyle={styles.messages}>{messages.map((message, index) => <View key={`${index}-${message}`} style={[styles.bubble, index % 2 ? styles.userBubble : styles.lumaBubble]}>{index % 2 === 0 ? <Image source={assets.portrait} style={styles.messageAvatar} /> : null}<Text style={styles.bubbleText}>{message}</Text></View>)}</ScrollView>
      <View style={styles.suggestions}><ScrollView horizontal showsHorizontalScrollIndicator={false}>{["Just listen", "Help me plan", "Remember this"].map((item) => <Pressable key={item} onPress={() => usePrompt(`${item}: `)} style={styles.suggestion}><Text style={styles.suggestionText}>{item}</Text></Pressable>)}</ScrollView></View>
      <View style={styles.composer}><Pressable accessibilityLabel="Open message tools" onPress={() => setToolsOpen(true)} style={styles.composerIcon}><Ionicons name="add" size={22} color="#D8CBDC" /></Pressable><TextInput accessibilityLabel="Message Luma" value={draft} onChangeText={onDraft} onSubmitEditing={onSend} placeholder="Message Luma…" placeholderTextColor="#817488" style={styles.input} /><Pressable accessibilityLabel="Start a voice call" onPress={() => onCall("voice")} style={styles.composerIcon}><Ionicons name="mic-outline" size={21} color="#D8CBDC" /></Pressable><Pressable accessibilityLabel="Send message" onPress={onSend} style={styles.send}><Ionicons name="arrow-up" size={19} color="#2C1622" /></Pressable></View>
      <Modal visible={toolsOpen} transparent animationType="slide" onRequestClose={() => setToolsOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setToolsOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>Add to your message</Text>
            <Pressable onPress={() => usePrompt("I want to share a photo with you: ")} style={styles.sheetAction}><Ionicons name="image-outline" size={21} color="#F39A88" /><Text style={styles.settingText}>Talk about a photo</Text></Pressable>
            <Pressable onPress={() => usePrompt("Please remember this: ")} style={styles.sheetAction}><Ionicons name="bookmark-outline" size={21} color="#F39A88" /><Text style={styles.settingText}>Save a memory</Text></Pressable>
            <Pressable onPress={() => { setToolsOpen(false); onCall("video"); }} style={styles.sheetAction}><Ionicons name="videocam-outline" size={21} color="#F39A88" /><Text style={styles.settingText}>Start a video call</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function Moments({ coins, onCoins, onCall, onScene, ownedScenes, completedActivities, onCompletedActivities }: { coins: number; onCoins: (coins: number) => void; onCall: (call: CallType) => void; onScene: (scene: SceneId) => void; ownedScenes: SceneId[]; completedActivities: string[]; onCompletedActivities: (activities: string[]) => void }) {
  const [tab, setTab] = useState<"moments" | "photos" | "together" | "calls">("moments");
  const photos = [assets.window, assets.cafe, assets.rooftop];
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.pageContent}>
        <Text style={styles.kicker}>YOUR SHARED LIFE</Text><Text style={styles.displayTitle}>Moments</Text><Text style={styles.subtitle}>The calls, photos, tiny wins, and jokes worth keeping.</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{(["moments", "photos", "together", "calls"] as const).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</ScrollView>
        {tab === "moments" ? <>{[["Our first call", assets.portrait, "23 min · voice call"], ["Rooftop at blue hour", assets.rooftop, "Virtual date"], ["You sent the pitch", assets.window, "Important goal"]].map(([title, image, detail]) => <View key={String(title)} style={styles.momentCard}><Image source={image as number} style={styles.momentImage} /><View style={styles.momentCopy}><Text style={styles.momentTitle}>{String(title)}</Text><Text style={styles.momentDetail}>{String(detail)}</Text></View></View>)}</> : null}
        {tab === "photos" ? <View style={styles.mobilePhotoGrid}>{photos.map((image, index) => <Image key={index} source={image} style={styles.mobilePhoto} />)}</View> : null}
        {tab === "together" ? <>{scenes.map((item) => { const owned = ownedScenes.includes(item.id); return <Pressable key={item.id} onPress={() => owned ? onScene(item.id) : Alert.alert("Scene locked", "Unlock this room from the Companion tab first.")} style={styles.dateCard}><Image source={item.image} style={styles.dateImage} /><View><Text style={styles.momentTitle}>{item.label} date</Text><Text style={styles.momentDetail}>{owned ? "Change the scene and start a video call" : "Unlock this room in Companion"}</Text></View></Pressable>; })}{["Would you rather", "Relationship cards", "Story together", "Daily reflection"].map((title) => { const completed = completedActivities.includes(title); return <Pressable key={title} disabled={completed} onPress={() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); onCoins(coins + 18); onCompletedActivities([...completedActivities, title]); }} style={styles.activity}><Ionicons name={completed ? "checkmark-circle" : "sparkles-outline"} size={19} color="#F39A88" /><View style={styles.flex}><Text style={styles.activityTitle}>{title}</Text><Text style={styles.momentDetail}>{completed ? "Completed" : "Complete together · +18 coins"}</Text></View><Ionicons name={completed ? "checkmark-circle" : "play-circle-outline"} size={23} color="#F3C2BF" /></Pressable>; })}</> : null}
        {tab === "calls" ? <View style={styles.callsPanel}><Image source={assets.portrait} style={styles.callPortrait} /><Text style={styles.momentTitle}>Call Luma</Text><Text style={styles.subtitle}>Voice for a quick check-in. Video for the room, expressions, and activities.</Text><View style={styles.callRow}><Pressable onPress={() => onCall("voice")} style={styles.lumaButton}><Ionicons name="call" color="#2C1622" size={18} /><Text style={styles.lumaButtonText}>Voice</Text></Pressable><Pressable onPress={() => onCall("video")} style={styles.lumaButton}><Ionicons name="videocam" color="#2C1622" size={19} /><Text style={styles.lumaButtonText}>Video</Text></Pressable></View></View> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Companion({ scene, onScene, coins, onCoins, ownedScenes, onOwnedScenes }: { scene: SceneId; onScene: (scene: SceneId) => void; coins: number; onCoins: (coins: number) => void; ownedScenes: SceneId[]; onOwnedScenes: (scenes: SceneId[]) => void }) {
  const [tab, setTab] = useState<"wardrobe" | "personality" | "voice">("wardrobe");
  const [selectedVoice, setSelectedVoice] = useState("Playful");
  const current = scenes.find((item) => item.id === scene) ?? scenes[0]!;
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.pageContent}>
        <Text style={styles.kicker}>HER LOOK, VOICE, AND ENERGY</Text><Text style={styles.displayTitle}>Luma</Text><Text style={styles.subtitle}>{coins} coins · offline product preview</Text>
        <Image source={current.image} style={styles.companionPreview} />
        <View style={styles.tabs}>{(["wardrobe", "personality", "voice"] as const).map((item) => <Pressable key={item} onPress={() => setTab(item)} style={[styles.tab, tab === item && styles.tabActive]}><Text style={[styles.tabText, tab === item && styles.tabTextActive]}>{item}</Text></Pressable>)}</View>
        {tab === "wardrobe" ? scenes.map((item) => { const owned = ownedScenes.includes(item.id); return <Pressable key={item.id} onPress={() => { if (owned) onScene(item.id); void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }} style={styles.wardrobeRow}><Image source={item.image} style={styles.wardrobeImage} /><View style={styles.flex}><Text style={styles.activityTitle}>{item.label}</Text><Text style={styles.momentDetail}>{scene === item.id ? "Equipped" : owned ? "Tap to equip" : "Unlock for 120 coins"}</Text></View>{scene === item.id ? <Ionicons name="checkmark-circle" color="#81C6A6" size={23} /> : owned ? null : <Pressable onPress={() => { if (coins < 120) return Alert.alert("Not enough coins", "Complete activities to earn more coins."); onCoins(coins - 120); onOwnedScenes([...ownedScenes, item.id]); onScene(item.id); }} style={styles.buy}><Text style={styles.buyText}>120</Text></Pressable>}</Pressable>; }) : null}
        {tab === "personality" ? ["Warm · 85%", "Playful · 85%", "Humor · 70%", "Confident · 75%", "Affection · 75%", "Flirtiness · 65%"].map((item) => <View key={item} style={styles.settingRow}><Text style={styles.settingText}>{item}</Text><View style={styles.progress}><View style={[styles.progressFill, { width: item.includes("65") ? "65%" : item.includes("70") ? "70%" : item.includes("75") ? "75%" : "85%" }]} /></View></View>) : null}
        {tab === "voice" ? ["Playful", "Warm", "Calm", "Confident"].map((item) => <Pressable key={item} onPress={() => { setSelectedVoice(item); void Haptics.selectionAsync(); }} style={styles.voiceRow}><View style={styles.playCircle}><Ionicons name={selectedVoice === item ? "volume-high" : "volume-medium-outline"} color="#2C1622" size={16} /></View><View style={styles.flex}><Text style={styles.activityTitle}>{item}</Text><Text style={styles.momentDetail}>{selectedVoice === item ? "Selected" : "Tap to select"}</Text></View>{selectedVoice === item ? <Ionicons name="checkmark-circle" color="#81C6A6" size={23} /> : null}</Pressable>) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function You({ memoryEnabled, onMemory, romanticMode, onRomantic }: { memoryEnabled: boolean; onMemory: (value: boolean) => void; romanticMode: boolean; onRomantic: (value: boolean) => void }) {
  const [setting, setSetting] = useState<string | null>(null);
  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.pageContent}>
        <Text style={styles.kicker}>YOUR STORY</Text><Text style={styles.displayTitle}>You</Text><Text style={styles.subtitle}>What Luma knows and the boundaries you control.</Text>
        <View style={styles.profileHero}><Image source={assets.portrait} style={styles.profilePortrait} /><View><Text style={styles.momentTitle}>You & Luma</Text><Text style={styles.momentDetail}>Offline preview · no account data loaded</Text></View></View>
        <Text style={styles.sectionLabel}>WHAT LUMA REMEMBERS</Text>
        <View style={styles.memoryRow}><Ionicons name="bookmark-outline" color="#F39A88" size={18} /><Text style={styles.settingText}>Signed-in memories appear in the web app.</Text></View>
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.settingText}>Use approved memories</Text><Text style={styles.momentDetail}>Every memory stays inspectable.</Text></View><Switch value={memoryEnabled} onValueChange={onMemory} trackColor={{ true: "#F39A88" }} /></View>
        <View style={styles.switchRow}><View style={styles.flex}><Text style={styles.settingText}>Romantic mode</Text><Text style={styles.momentDetail}>Adult opt-in with healthy boundaries.</Text></View><Switch value={romanticMode} onValueChange={onRomantic} trackColor={{ true: "#F39A88" }} /></View>
        {["Notifications & quiet hours", "Incoming calls · Rarely", "Privacy & camera", "Subscription · Web account", "Export my data", "Delete account"].map((item) => <Pressable key={item} onPress={() => setSetting(item)} style={styles.settingNav}><Text style={styles.settingText}>{item}</Text><Ionicons name="chevron-forward" color="#A598AD" size={17} /></Pressable>)}
      </ScrollView>
      <Modal visible={Boolean(setting)} transparent animationType="slide" onRequestClose={() => setSetting(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSetting(null)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetTitle}>{setting}</Text>
            <Text style={styles.sheetBody}>{setting === "Delete account" ? "Account deletion requires a signed-in production session and a final confirmation." : setting === "Export my data" ? "Your export includes conversations, memories, journal entries, purchases, and preferences." : "This preference is available in the signed-in web app and syncs to your account."}</Text>
            <Pressable onPress={() => setSetting(null)} style={styles.lumaButton}><Text style={styles.lumaButtonText}>Done</Text></Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function BottomNav({ active, onOpen }: { active: ViewId; onOpen: (view: ViewId) => void }) {
  return (
    <SafeAreaView pointerEvents="box-none" style={styles.bottomSafe}>
      <View style={styles.nav}>{navigation.map((item) => <Pressable accessibilityRole="button" accessibilityState={{ selected: active === item.id }} key={item.id} onPress={() => onOpen(item.id)} style={[styles.navItem, active === item.id && styles.navItemActive]}><Ionicons name={active === item.id ? item.active : item.icon} size={21} color={active === item.id ? "#F39A88" : "#A598AD"} /><Text style={[styles.navLabel, active === item.id && styles.navLabelActive]}>{item.label}</Text></Pressable>)}</View>
    </SafeAreaView>
  );
}

function CallScreen({ type, scene, cameraOn, onCamera, onClose }: { type: CallType; scene: SceneId; cameraOn: boolean; onCamera: () => void; onClose: () => void }) {
  const [seconds, setSeconds] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(true);
  const [speakerOn, setSpeakerOn] = useState(true);
  const [heartSent, setHeartSent] = useState(false);
  const current = scenes.find((item) => item.id === scene) ?? scenes[0]!;
  const time = useMemo(() => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`, [seconds]);

  useEffect(() => {
    if (!type) return;
    setSeconds(0);
    const timer = setInterval(() => setSeconds((value) => value + 1), 1_000);
    const turns = setInterval(() => setSpeaking((value) => !value), 4_000);
    return () => { clearInterval(timer); clearInterval(turns); };
  }, [type]);

  return (
    <Modal visible={Boolean(type)} animationType="fade" onRequestClose={onClose}>
      <ImageBackground source={type === "video" ? current.image : assets.portrait} style={styles.callScreen} resizeMode="cover">
        <View style={styles.callVeil} />
        <SafeAreaView style={styles.callSafe}>
          <View style={styles.callHeader}><Text style={styles.callStatus}>{type === "video" ? "VIDEO CALL" : "VOICE CALL"}</Text><Text style={styles.callName}>Luma</Text><Text style={styles.callTime}>{time}</Text></View>
          {type === "video" && cameraOn ? <CameraView style={styles.userCamera} facing="front" /> : type === "video" ? <View style={styles.userCameraOff}><Ionicons name="camera-outline" size={24} color="#A598AD" /><Text style={styles.cameraOffText}>Your camera is off</Text></View> : null}
          <View style={styles.callBottom}><Pressable accessibilityLabel="Interrupt Luma" onPress={() => setSpeaking(false)} style={styles.listeningPill}><Ionicons name="pulse" color="#F39A88" size={18} /><Text style={styles.listeningText}>{speaking ? "Luma is speaking · tap to interrupt" : "Listening to you"}</Text></Pressable>{heartSent ? <Text style={styles.reactionText}>Heart sent to Luma</Text> : null}<Text style={styles.caption}>{speaking ? "Heyyy. I’m here. Tell me the unfiltered version." : "Go on—I won’t interrupt."}</Text><View style={styles.callControls}><Pressable accessibilityLabel={muted ? "Unmute microphone" : "Mute microphone"} onPress={() => { setMuted((value) => !value); setSpeaking(false); }} style={[styles.callControl, muted && styles.callControlActive]}><Ionicons name={muted ? "mic-off" : "mic"} size={22} color={muted ? "#2C1622" : "#FFF8F4"} /></Pressable>{type === "video" ? <Pressable accessibilityLabel={cameraOn ? "Turn camera off" : "Turn camera on"} onPress={onCamera} style={[styles.callControl, cameraOn && styles.callControlActive]}><Ionicons name={cameraOn ? "videocam" : "videocam-off"} size={22} color={cameraOn ? "#2C1622" : "#FFF8F4"} /></Pressable> : null}<Pressable accessibilityLabel="Toggle speaker" onPress={() => setSpeakerOn((value) => !value)} style={[styles.callControl, speakerOn && styles.callControlActive]}><Ionicons name={speakerOn ? "volume-high" : "volume-mute-outline"} size={22} color={speakerOn ? "#2C1622" : "#FFF8F4"} /></Pressable><Pressable accessibilityLabel="Send a heart" onPress={() => { setHeartSent(true); void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }} style={[styles.callControl, heartSent && styles.callControlActive]}><Ionicons name={heartSent ? "heart" : "heart-outline"} size={23} color={heartSent ? "#E06E76" : "#FFF8F4"} /></Pressable><Pressable accessibilityLabel="End call" onPress={onClose} style={styles.endCall}><Ionicons name="call" size={23} color="#FFF" style={{ transform: [{ rotate: "135deg" }] }} /></Pressable></View><Text style={styles.disclosure}>Mock realtime call · raw audio and video are never stored</Text></View>
        </SafeAreaView>
      </ImageBackground>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#120F1B" },
  flex: { flex: 1 },
  home: { flex: 1, backgroundColor: "#120F1B" },
  homeVeil: { position: "absolute", inset: 0, backgroundColor: "rgba(10,7,16,.13)" },
  homeSafe: { flex: 1 },
  homeHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8 },
  portraitButton: { width: 44, height: 44, borderWidth: 2, borderColor: "#F39A88", borderRadius: 22 },
  portrait: { width: "100%", height: "100%", borderRadius: 22 },
  portraitSpark: { position: "absolute", right: -5, bottom: -3, padding: 4, borderRadius: 10, backgroundColor: "#F3C2BF" },
  wordmark: { color: "#F3C2BF", fontFamily: "Georgia", fontSize: 42 },
  levelPill: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 38, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.24)", borderRadius: 20, backgroundColor: "rgba(35,27,48,.72)" },
  levelText: { color: "#F3C2BF", fontSize: 11, fontWeight: "600" },
  avatarTap: { position: "absolute", top: 120, left: 70, right: 38, bottom: 240 },
  speech: { position: "absolute", top: 135, right: 18, width: Math.min(width * .49, 210), padding: 17, borderRadius: 24, borderBottomRightRadius: 6, backgroundColor: "rgba(255,248,242,.94)" },
  speechTitle: { color: "#55355F", fontFamily: "Georgia", fontSize: 26, lineHeight: 29 },
  speechSub: { marginTop: 7, color: "#765B7C", fontSize: 12 },
  speechGlow: { position: "absolute", right: 12, bottom: -28, width: 44, height: 8, borderRadius: 10, backgroundColor: "#E88BB0" },
  sceneRow: { position: "absolute", left: 0, right: 0, bottom: 215 },
  sceneScroll: { paddingHorizontal: 18, gap: 8 },
  scenePill: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 42, paddingHorizontal: 13, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.18)", borderRadius: 22, backgroundColor: "rgba(35,27,48,.7)" },
  scenePillActive: { borderColor: "#F39A88" },
  sceneText: { color: "#D8CBDC", fontSize: 10 },
  homeActions: { position: "absolute", left: 18, right: 18, bottom: 84, flexDirection: "row", alignItems: "flex-end", justifyContent: "center", gap: 8 },
  sideAction: { flex: 1, maxWidth: 100, minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.2)", borderRadius: 24, backgroundColor: "rgba(35,27,48,.78)" },
  sideActionText: { color: "#FFF8F4", fontSize: 10 },
  callAction: { width: 112, height: 112, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(255,255,255,.65)", borderRadius: 56, backgroundColor: "#F39A88" },
  callText: { color: "#3C2030", fontFamily: "Georgia", fontSize: 25 },
  page: { flex: 1, backgroundColor: "#120F1B" },
  pageContent: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 112 },
  pageHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,.12)" },
  headerAvatar: { width: 46, height: 46, borderRadius: 23 },
  headerCopy: { flex: 1 },
  pageTitle: { color: "#FFF8F4", fontFamily: "Georgia", fontSize: 27 },
  online: { color: "#81C6A6", fontSize: 9 },
  iconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.12)", borderRadius: 21 },
  messages: { padding: 16, paddingBottom: 20 },
  bubble: { maxWidth: "88%", marginVertical: 5, padding: 13, borderRadius: 20 },
  lumaBubble: { alignSelf: "flex-start", marginLeft: 26, backgroundColor: "#211A2D", borderBottomLeftRadius: 5 },
  userBubble: { alignSelf: "flex-end", backgroundColor: "#724B62", borderBottomRightRadius: 5 },
  messageAvatar: { position: "absolute", left: -32, bottom: 0, width: 26, height: 26, borderRadius: 13 },
  bubbleText: { color: "#FFF8F4", fontSize: 14, lineHeight: 20 },
  suggestions: { paddingLeft: 12, paddingBottom: 8 },
  suggestion: { marginRight: 7, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.12)", borderRadius: 18 },
  suggestionText: { color: "#A598AD", fontSize: 9 },
  composer: { flexDirection: "row", alignItems: "center", gap: 5, marginHorizontal: 10, marginBottom: 85, padding: 6, borderRadius: 28, backgroundColor: "#211A2D" },
  composerIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  input: { flex: 1, minHeight: 38, color: "#FFF8F4", fontSize: 13 },
  send: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19, backgroundColor: "#F39A88" },
  kicker: { color: "#F39A88", fontSize: 9, fontWeight: "800", letterSpacing: 1.3 },
  displayTitle: { marginTop: 4, color: "#FFF8F4", fontFamily: "Georgia", fontSize: 56, lineHeight: 62 },
  subtitle: { marginTop: 3, marginBottom: 17, color: "#A598AD", fontSize: 12, lineHeight: 18 },
  tabs: { flexDirection: "row", gap: 6, marginBottom: 16 },
  tab: { minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: 18, backgroundColor: "#1C1726" },
  tabActive: { backgroundColor: "rgba(243,154,136,.16)" },
  tabText: { color: "#A598AD", fontSize: 10, textTransform: "capitalize" },
  tabTextActive: { color: "#F3C2BF" },
  momentCard: { height: 330, marginBottom: 12, overflow: "hidden", borderRadius: 25, backgroundColor: "#1C1726" },
  momentImage: { width: "100%", height: "100%" },
  momentCopy: { position: "absolute", left: 12, right: 12, bottom: 12, padding: 14, borderRadius: 16, backgroundColor: "rgba(20,14,29,.76)" },
  momentTitle: { color: "#FFF8F4", fontFamily: "Georgia", fontSize: 24 },
  momentDetail: { marginTop: 3, color: "#A598AD", fontSize: 9 },
  mobilePhotoGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  mobilePhoto: { width: (width - 44) / 2, height: 240, borderRadius: 18 },
  dateCard: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10, padding: 9, borderRadius: 18, backgroundColor: "#1C1726" },
  dateImage: { width: 84, height: 84, borderRadius: 14 },
  activity: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 16, borderRadius: 18, backgroundColor: "#1C1726" },
  activityTitle: { color: "#FFF8F4", fontSize: 13, fontWeight: "600" },
  callsPanel: { alignItems: "center", padding: 24, borderRadius: 24, backgroundColor: "#1C1726" },
  callPortrait: { width: 130, height: 130, marginBottom: 14, borderRadius: 65 },
  callRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  lumaButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 42, paddingHorizontal: 16, borderRadius: 22, backgroundColor: "#F39A88" },
  lumaButtonText: { color: "#2C1622", fontWeight: "700" },
  companionPreview: { width: "100%", height: 470, marginBottom: 14, borderRadius: 26 },
  wardrobeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 9, borderRadius: 18, backgroundColor: "#1C1726" },
  wardrobeImage: { width: 72, height: 72, borderRadius: 13 },
  buy: { minWidth: 48, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 17, backgroundColor: "rgba(243,154,136,.14)" },
  buyText: { color: "#F3C2BF", fontSize: 10, fontWeight: "700" },
  settingRow: { marginBottom: 13, padding: 15, borderRadius: 17, backgroundColor: "#1C1726" },
  settingText: { color: "#FFF8F4", fontSize: 12, fontWeight: "600" },
  progress: { height: 5, marginTop: 10, overflow: "hidden", borderRadius: 5, backgroundColor: "rgba(255,255,255,.1)" },
  progressFill: { height: "100%", borderRadius: 5, backgroundColor: "#F39A88" },
  voiceRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 8, padding: 14, borderRadius: 18, backgroundColor: "#1C1726" },
  playCircle: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20, backgroundColor: "#F39A88" },
  profileHero: { flexDirection: "row", alignItems: "center", gap: 14, marginVertical: 15, padding: 14, borderRadius: 20, backgroundColor: "#1C1726" },
  profilePortrait: { width: 70, height: 70, borderRadius: 22 },
  sectionLabel: { marginTop: 16, marginBottom: 8, color: "#F39A88", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  memoryRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 7, padding: 14, borderRadius: 16, backgroundColor: "#1C1726" },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8, padding: 15, borderRadius: 17, backgroundColor: "#1C1726" },
  settingNav: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(255,255,255,.1)" },
  bottomSafe: { position: "absolute", left: 0, right: 0, bottom: 0 },
  nav: { flexDirection: "row", marginHorizontal: 10, marginBottom: 8, padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.16)", borderRadius: 24, backgroundColor: "rgba(25,20,34,.94)" },
  navItem: { flex: 1, minHeight: 54, alignItems: "center", justifyContent: "center", gap: 2, borderRadius: 17 },
  navItemActive: { backgroundColor: "rgba(243,154,136,.1)" },
  navLabel: { color: "#A598AD", fontSize: 8 },
  navLabelActive: { color: "#F39A88" },
  callScreen: { flex: 1, backgroundColor: "#120F1B" },
  callVeil: { position: "absolute", inset: 0, backgroundColor: "rgba(10,7,16,.32)" },
  callSafe: { flex: 1 },
  callHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18, paddingTop: 8 },
  callStatus: { color: "#81C6A6", fontSize: 8, letterSpacing: 1 },
  callName: { color: "#FFF8F4", fontFamily: "Georgia", fontSize: 31 },
  callTime: { color: "#D8CBDC", fontVariant: ["tabular-nums"] },
  userCamera: { position: "absolute", top: 72, right: 14, width: 105, height: 150, overflow: "hidden", borderRadius: 18 },
  userCameraOff: { position: "absolute", top: 72, right: 14, width: 105, height: 150, alignItems: "center", justifyContent: "center", gap: 6, borderRadius: 18, backgroundColor: "rgba(28,23,38,.86)" },
  cameraOffText: { color: "#A598AD", fontSize: 8 },
  callBottom: { position: "absolute", left: 14, right: 14, bottom: 20, alignItems: "center" },
  listeningPill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, backgroundColor: "rgba(28,23,38,.78)" },
  listeningText: { color: "#F3C2BF", fontSize: 9 },
  caption: { marginVertical: 16, color: "#FFF8F4", fontFamily: "Georgia", fontSize: 22, textAlign: "center" },
  callControls: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  callControl: { width: 50, height: 50, alignItems: "center", justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,.2)", borderRadius: 25, backgroundColor: "rgba(28,23,38,.74)" },
  callControlActive: { backgroundColor: "#FFF8F4" },
  endCall: { width: 58, height: 58, alignItems: "center", justifyContent: "center", borderRadius: 29, backgroundColor: "#E06E76" },
  disclosure: { marginTop: 14, color: "rgba(255,255,255,.55)", fontSize: 8 },
  reactionText: { marginTop: 10, color: "#F3C2BF", fontSize: 10 },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(8,6,12,.7)" },
  sheet: { gap: 10, padding: 20, paddingBottom: 34, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: "#211A2D" },
  sheetTitle: { color: "#FFF8F4", fontFamily: "Georgia", fontSize: 28 },
  sheetBody: { marginBottom: 8, color: "#A598AD", fontSize: 13, lineHeight: 20 },
  sheetAction: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, backgroundColor: "#1C1726" },
});
