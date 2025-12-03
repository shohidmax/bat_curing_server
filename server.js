const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); // File upload er jonno
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());
// Firmware file serve korar jonno static folder
app.use('/firmware', express.static(path.join(__dirname, 'uploads')));

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){
    fs.mkdirSync(uploadDir);
}

// MongoDB Connection
const uri = "mongodb+srv://shohidmax_db_user:ZdTUKDQ9Z0sgKIjk@batb.ryu6iku.mongodb.net/tobacco_curing?retryWrites=true&w=majority&appName=batb";

mongoose.connect(uri)
  .then(() => console.log("MongoDB Connected"))
  .catch(err => console.log("Error: ", err));

// --- SCHEMAS ---

const DeviceSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    dryTemp: Number,
    wetTemp: Number,
    setDryTemp: Number,
    setWetTemp: Number,
    phase: Number,
    mode: Number,
    relay1: Boolean,
    relay2: Boolean,
    lastSeen: { type: Date, default: Date.now }
});

const PhaseSettingsSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    phases: [{
        name: String,
        steps: [{ db: Number, wb: Number }]
    }]
});

const CommandSchema = new mongoose.Schema({
    deviceId: { type: String, required: true },
    command: String,
    payload: Object,
    executed: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

const Device = mongoose.model('Device', DeviceSchema);
const PhaseSettings = mongoose.model('PhaseSettings', PhaseSettingsSchema);
const Command = mongoose.model('Command', CommandSchema);

// --- FILE UPLOAD CONFIG ---
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/')
    },
    filename: function (req, file, cb) {
      // Always name it 'firmware.bin' to keep it simple, or add timestamp
      cb(null, 'firmware.bin') 
    }
});
const upload = multer({ storage: storage });

// --- ROUTES ---

// 1. Device Update & Command Check
app.post('/api/update', async (req, res) => {
    const { deviceId, dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2 } = req.body;
    try {
        await Device.findOneAndUpdate({ deviceId }, { 
            dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2, lastSeen: new Date()
        }, { upsert: true, new: true });

        const pendingCommand = await Command.findOne({ deviceId, executed: false }).sort({ timestamp: 1 });
        if (pendingCommand) {
            pendingCommand.executed = true;
            await pendingCommand.save();
            res.json({ status: "success", hasCommand: true, command: pendingCommand.command, payload: pendingCommand.payload });
        } else {
            res.json({ status: "success", hasCommand: false });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. Status Fetch
app.get('/api/status/:deviceId', async (req, res) => {
    try {
        const status = await Device.findOne({ deviceId: req.params.deviceId });
        res.json(status || {});
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 3. Phase Settings Fetch
app.get('/api/phases/:deviceId', async (req, res) => {
    try {
        let settings = await PhaseSettings.findOne({ deviceId: req.params.deviceId });
        if (!settings) {
            settings = { deviceId: req.params.deviceId, phases: [
                { name: "Yellowing", steps: [{db:95, wb:92}, {db:96, wb:93}, {db:98, wb:94}, {db:99, wb:95}, {db:100, wb:96}] },
                { name: "Lamina", steps: [{db:100, wb:96}, {db:102, wb:96}, {db:104, wb:97}, {db:106, wb:97}, {db:108, wb:98}] }
            ]};
        }
        res.json(settings);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 4. Save Phases
app.post('/api/phases', async (req, res) => {
    const { deviceId, phases } = req.body;
    try {
        await PhaseSettings.findOneAndUpdate({ deviceId }, { phases }, { upsert: true, new: true });
        const newCommand = new Command({ deviceId, command: "UPDATE_PHASE_CONFIG", payload: { phases } });
        await newCommand.save();
        res.json({ status: "Configuration Updated & Queued" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 5. General Command
app.post('/api/command', async (req, res) => {
    const { deviceId, command, payload } = req.body;
    try {
        const newCommand = new Command({ deviceId, command, payload });
        await newCommand.save();
        res.json({ status: "Command queued" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// 6. Firmware Upload & OTA Trigger (NEW)
app.post('/api/upload-firmware', upload.single('firmware'), async (req, res) => {
    const deviceId = req.body.deviceId;
    
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    // Construct the public URL for the firmware
    // NOTE: In production, use your actual domain "https://batcuring.espserver.site"
    const firmwareUrl = `https://batcuring.espserver.site/firmware/firmware.bin`;

    try {
        // Queue the OTA command for ESP32
        const newCommand = new Command({ 
            deviceId, 
            command: "UPDATE_FIRMWARE", 
            payload: { url: firmwareUrl } 
        });
        await newCommand.save();
        
        res.json({ status: "Firmware uploaded & OTA command queued", url: firmwareUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => { console.log(`Server running on port ${PORT}`); });