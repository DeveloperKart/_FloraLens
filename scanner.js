
"use strict";

/* =========================================
   FLORALENS — PLANT SCANNER
   ========================================= */

const MODEL_URL =
    "https://teachablemachine.withgoogle.com/models/mIiK1Xitk/";

// Scanner settings
const CONFIDENCE_THRESHOLD = 0.85;
const REQUIRED_STABLE_FRAMES = 5;
const CAMERA_WIDTH = 400;
const CAMERA_HEIGHT = 400;

// Voice is enabled by default
let voiceEnabled = true;

// Teachable Machine objects
let model = null;
let webcam = null;

// Scanner state
let isRunning = false;
let isStarting = false;
let animationFrameId = null;
let stableLabel = "";
let stableFrameCount = 0;
let lastDisplayedLabel = "";
let lastSpokenLabel = "";

/* =========================================
   HTML ELEMENTS
   ========================================= */

const cameraElement = document.getElementById("camera");
const statusElement = document.getElementById("status");
const resultElement = document.getElementById("result");
const detailsElement = document.getElementById("details");
const predictionsElement = document.getElementById("predictions");
const confidenceInfoElement =
    document.getElementById("confidenceInfo");

const startButton = document.getElementById("startBtn");
const stopButton = document.getElementById("stopBtn");
const voiceButton = document.getElementById("voiceBtn");

/* =========================================
   PLANT INFORMATION DATABASE
   ========================================= */

const classInfo = {
    "tulsi": {
        name: "Tulsi",
        type: "Medicinal Plant",
        description: [
            "Benefit 1: Tulsi leaves are traditionally used in herbal preparations for coughs and colds, although evidence for treating these conditions is limited.",
            "Benefit 2: Tulsi contains plant compounds with antioxidant activity demonstrated in laboratory studies."
        ]
    },

    "bryophyllum pinnatum": {
        name: "Bryophyllum pinnatum",
        type: "Medicinal Plant",
        description: [
            "Benefit 1: It is grown as an ornamental succulent and can be propagated using plantlets along its leaf margins.",
            "Benefit 2: It is studied by researchers for potentially useful plant compounds, including antioxidant activity; its medicinal effectiveness in humans is not well established."
        ]
    },

    "aloe vera": {
        name: "Aloe Vera",
        type: "Medicinal Plant",
        description: [
            "Benefit 1: Aloe vera gel can help soothe and moisturize dry skin.",
            "Benefit 2: Certain aloe vera gel products may help soothe minor skin irritation and burns, although evidence varies by use and product."
        ]
    },

    "crabgrass": {
        name: "Crabgrass",
        type: "Weed",
        description: [
            "Crabgrass is a common grass weed that grows in lawns, gardens, fields, and along roadsides. It grows quickly and can compete with nearby plants for nutrients, water, light, and space."
        ]
    },

    "background / noise": {
        name: "Background / Noise",
        type: "Background",
        description: []
    }
};

/* =========================================
   LABEL NORMALIZATION
   FIXES:
   Tulsi (Medicinal Plant) -> tulsi
   Aloe Vera (Medicinal Plant) -> aloe vera
   Crabgrass (Weed) -> crabgrass
   ========================================= */

function normaliseLabel(label) {
    return String(label || "")
        .toLowerCase()
        .trim()

        // Remove category information inside parentheses
        .replace(/\s*\([^)]*\)/g, "")

        // Normalize spacing
        .replace(/\s+/g, " ")
        .trim();
}

function makeLabelKey(label) {
    return normaliseLabel(label)
        .replace(/[_-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getClassInfo(label) {
    const key = makeLabelKey(label);

    const aliases = {
        "holy basil": "tulsi",
        "ocimum tenuiflorum": "tulsi",
        "ocimum sanctum": "tulsi",

        "bryophyllum": "bryophyllum pinnatum",
        "brophyllum pinnatum": "bryophyllum pinnatum",
        "brophyllum": "bryophyllum pinnatum",
        "kalanchoe pinnata": "bryophyllum pinnatum",

        "aloe": "aloe vera",
        "crabgrass weed": "crabgrass",

        "background": "background / noise",
        "background noise": "background / noise",
        "noise": "background / noise",
        "background/noise": "background / noise"
    };

    const databaseKey = aliases[key] || key;
    const info = classInfo[databaseKey] || null;

    console.log("FloraLens class matching:", {
        receivedLabel: label,
        normalizedKey: key,
        databaseKey: databaseKey,
        matched: Boolean(info)
    });

    return info;
}

/* =========================================
   SAFE TEXT DISPLAY
   ========================================= */

function setStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
}

function displayResult(label, confidence) {
    const info = getClassInfo(label);

    if (!info) {
        if (resultElement) {
            resultElement.textContent = label;
        }

        if (detailsElement) {
            detailsElement.textContent =
                "Plant information is not configured for this class: " +
                label +
                ". Check the browser console.";
        }

        console.warn(
            "FloraLens: Missing class information for:",
            label
        );

        return;
    }

    if (resultElement) {
        resultElement.textContent = info.name;
    }

    if (!detailsElement) {
        return;
    }

    detailsElement.replaceChildren();

    if (info.type === "Background") {
        detailsElement.textContent =
            "Benefits will appear here if any medicinal plant is recognized.";
        return;
    }

    const typeElement = document.createElement("p");
    typeElement.textContent = info.type;
    typeElement.style.fontWeight = "700";
    typeElement.style.color = "#278454";

    detailsElement.appendChild(typeElement);

    for (const description of info.description) {
        const paragraph = document.createElement("p");
        paragraph.textContent = description;
        detailsElement.appendChild(paragraph);
    }

    if (typeof confidence === "number") {
        const confidenceElement = document.createElement("p");

        confidenceElement.textContent =
            "AI confidence: " + (confidence * 100).toFixed(1) + "%";

        confidenceElement.style.fontSize = "12px";
        confidenceElement.style.color = "#758277";

        detailsElement.appendChild(confidenceElement);
    }
}

/* =========================================
   VOICE ASSISTANT
   Speaks the plant name and its information
   ========================================= */

function getVoiceMessage(label) {
    const info = getClassInfo(label);

    if (!info) {
        return "FloraLens could not find information for this class.";
    }

    if (info.type === "Background") {
        return "No medicinal plant has been recognized. " +
            "Benefits will appear here if any medicinal plant is recognized.";
    }

    return (
        "FloraLens has identified it as " +
        info.name +
        ". " +
        info.description.join(" ")
    );
}

function speakResult(label) {
    if (!voiceEnabled) {
        return;
    }

    if (!("speechSynthesis" in window)) {
        console.warn("Speech synthesis is not supported in this browser.");
        return;
    }

    const info = getClassInfo(label);

    if (!info) {
        return;
    }

    const normalized = makeLabelKey(label);

    // Do not announce the same detection repeatedly
    if (normalized === lastSpokenLabel) {
        return;
    }

    lastSpokenLabel = normalized;

    window.speechSynthesis.cancel();

    const speech = new SpeechSynthesisUtterance(
        getVoiceMessage(label)
    );

    speech.lang = "en-IN";
    speech.rate = 0.9;
    speech.pitch = 1;

    window.speechSynthesis.speak(speech);
}

function updateVoiceButton() {
    if (!voiceButton) {
        return;
    }

    voiceButton.textContent = voiceEnabled
        ? "Voice: ON"
        : "Voice: OFF";

    voiceButton.setAttribute(
        "aria-pressed",
        String(voiceEnabled)
    );
}

/* =========================================
   CONFIDENCE BARS
   ========================================= */

function updatePredictions(predictions) {
    if (!predictionsElement) {
        return;
    }

    predictionsElement.replaceChildren();

    const sortedPredictions = [...predictions].sort(
        (a, b) => b.probability - a.probability
    );

    for (const prediction of sortedPredictions) {
        const percentage = prediction.probability * 100;

        const row = document.createElement("div");
        row.className = "prediction";

        const label = document.createElement("div");

        label.style.display = "flex";
        label.style.justifyContent = "space-between";
        label.style.gap = "12px";

        const name = document.createElement("span");
        name.textContent = prediction.className;

        const score = document.createElement("span");
        score.textContent = percentage.toFixed(1) + "%";

        label.append(name, score);

        const bar = document.createElement("div");
        bar.className = "bar";
        bar.setAttribute("role", "progressbar");
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute(
            "aria-valuenow",
            percentage.toFixed(1)
        );
        bar.setAttribute(
            "aria-label",
            prediction.className + " confidence"
        );

        const fill = document.createElement("div");
        fill.className = "fill";
        fill.style.width = percentage + "%";

        bar.appendChild(fill);
        row.append(label, bar);
        predictionsElement.appendChild(row);
    }

    if (confidenceInfoElement) {
        confidenceInfoElement.textContent =
            "Recognition threshold: " +
            (CONFIDENCE_THRESHOLD * 100) +
            "%. The scanner waits for " +
            REQUIRED_STABLE_FRAMES +
            " consecutive stable frames.";
    }
}

/* =========================================
   STABLE-FRAME RECOGNITION
   ========================================= */

function resetStableDetection() {
    stableLabel = "";
    stableFrameCount = 0;
}

function processPredictions(predictions) {
    updatePredictions(predictions);

    if (!predictions || predictions.length === 0) {
        resetStableDetection();
        return;
    }

    const bestPrediction = predictions.reduce(
        (best, current) =>
            current.probability > best.probability
                ? current
                : best
    );

    const label = bestPrediction.className;
    const confidence = bestPrediction.probability;
    const normalized = makeLabelKey(label);

    if (confidence < CONFIDENCE_THRESHOLD) {
        resetStableDetection();

        setStatus(
            "Looking for a clear plant image... Best match: " +
            label +
            " (" +
            (confidence * 100).toFixed(1) +
            "%)."
        );

        return;
    }

    if (normalized === stableLabel) {
        stableFrameCount++;
    } else {
        stableLabel = normalized;
        stableFrameCount = 1;
    }

    if (stableFrameCount < REQUIRED_STABLE_FRAMES) {
        setStatus(
            "Checking recognition stability... " +
            stableFrameCount +
            "/" +
            REQUIRED_STABLE_FRAMES
        );

        return;
    }

    setStatus(
        "Recognition complete: " +
        label +
        " (" +
        (confidence * 100).toFixed(1) +
        "%)."
    );

    // Only update and speak when the detected class changes.
    if (normalized !== lastDisplayedLabel) {
        lastDisplayedLabel = normalized;

        displayResult(label, confidence);
        speakResult(label);
    }
}

/* =========================================
   MODEL LOADING
   ========================================= */

async function loadModel() {
    if (model) {
        return model;
    }

    if (typeof tmImage === "undefined") {
        throw new Error(
            "Teachable Machine library did not load. " +
            "Check your internet connection and script tags."
        );
    }

    const modelPath = MODEL_URL + "model.json";
    const metadataPath = MODEL_URL + "metadata.json";

    setStatus("Loading the FloraLens AI model...");

    model = await tmImage.load(modelPath, metadataPath);

    console.log(
        "FloraLens model loaded.",
        model.getClassLabels()
    );

    return model;
}

/* =========================================
   START SCANNER
   ========================================= */

async function startScanner() {
    if (isRunning || isStarting) {
        return;
    }

    isStarting = true;

    if (startButton) startButton.disabled = true;
    if (stopButton) stopButton.disabled = true;

    try {
        if (!navigator.mediaDevices ||
            !navigator.mediaDevices.getUserMedia) {
            throw new Error(
                "Camera access is unavailable. Open FloraLens " +
                "through localhost or a secure HTTPS website."
            );
        }

        await loadModel();

        setStatus("Starting your camera...");

        webcam = new tmImage.Webcam(
            CAMERA_WIDTH,
            CAMERA_HEIGHT,
            true
        );

        await webcam.setup();
        await webcam.play();

        if (cameraElement) {
            cameraElement.replaceChildren(webcam.canvas);
        }

        isRunning = true;

        resetStableDetection();
        lastDisplayedLabel = "";
        lastSpokenLabel = "";

        if (startButton) startButton.disabled = true;
        if (stopButton) stopButton.disabled = false;

        setStatus("Camera started. Point it at a plant.");

        animationFrameId = requestAnimationFrame(scanLoop);
    } catch (error) {
        console.error("FloraLens scanner error:", error);

        setStatus(
            "Could not start the scanner: " +
            (error.message || "Unknown error") +
            " Please check camera permission and model access."
        );

        if (webcam) {
            try {
                webcam.stop();
            } catch (stopError) {
                console.warn(stopError);
            }
        }

        webcam = null;
        isRunning = false;

        if (startButton) startButton.disabled = false;
        if (stopButton) stopButton.disabled = true;
    } finally {
        isStarting = false;
    }
}

/* =========================================
   SCANNER LOOP
   ========================================= */

async function scanLoop() {
    if (!isRunning || !webcam || !model) {
        return;
    }

    try {
        webcam.update();

        const predictions = await model.predict(webcam.canvas);

        if (!isRunning) {
            return;
        }

        processPredictions(predictions);
    } catch (error) {
        console.error("FloraLens prediction error:", error);

        setStatus(
            "An error occurred during recognition. Check the console."
        );
    }

    if (isRunning) {
        animationFrameId = requestAnimationFrame(scanLoop);
    }
}

/* =========================================
   STOP SCANNER
   ========================================= */

function stopScanner() {
    isRunning = false;

    if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    if (webcam) {
        try {
            webcam.stop();
        } catch (error) {
            console.warn("Could not stop webcam cleanly:", error);
        }

        webcam = null;
    }

    if (cameraElement) {
        cameraElement.replaceChildren();
    }

    resetStableDetection();

    if (startButton) startButton.disabled = false;
    if (stopButton) stopButton.disabled = true;

    setStatus("Scanner stopped. Start again when you're ready.");
}

/* =========================================
   EVENT LISTENERS
   ========================================= */

if (startButton) {
    startButton.addEventListener("click", startScanner);
}

if (stopButton) {
    stopButton.addEventListener("click", stopScanner);
}

if (voiceButton) {
    voiceButton.addEventListener("click", () => {
        voiceEnabled = !voiceEnabled;

        if (!voiceEnabled && "speechSynthesis" in window) {
            window.speechSynthesis.cancel();
        }

        updateVoiceButton();

        if (voiceEnabled && lastDisplayedLabel) {
            // Allow the current plant to be spoken again.
            lastSpokenLabel = "";
            speakResult(lastDisplayedLabel);
        }
    });
}

/* =========================================
   INITIALIZE FLORALENS
   ========================================= */

updateVoiceButton();

if (resultElement) {
    resultElement.textContent = "Waiting for a plant...";
}

if (detailsElement) {
    detailsElement.textContent =
        "Start the scanner to identify a plant.";
}

setStatus("Ready. Start the scanner to load the AI model.");

console.log("FloraLens scanner initialized.");
