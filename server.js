const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer'); 
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());
app.use('/firmware', express.static(path.join(__dirname, 'uploads')));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)){ fs.mkdirSync(uploadDir); }

const uri = "mongodb+srv://shohidmax_db_user:ZdTUKDQ9Z0sgKIjk@batb.ryu6iku.mongodb.net/tobacco_curing?retryWrites=true&w=majority&appName=batb";
mongoose.connect(uri).then(() => console.log("MongoDB Connected"));

const DeviceSchema = new mongoose.Schema({
    deviceId: String, dryTemp: Number, wetTemp: Number, setDryTemp: Number, setWetTemp: Number,
    phase: Number, mode: Number, relay1: Boolean, relay2: Boolean, lastSeen: Date, phaseName: String
});
const PhaseSettingsSchema = new mongoose.Schema({
    deviceId: String, phases: [{ name: String, steps: [{ db: Number, wb: Number }] }]
});
const CommandSchema = new mongoose.Schema({
    deviceId: String, command: String, payload: Object, executed: Boolean, timestamp: Date
});

const Device = mongoose.model('Device', DeviceSchema);
const PhaseSettings = mongoose.model('PhaseSettings', PhaseSettingsSchema);
const Command = mongoose.model('Command', CommandSchema);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, 'firmware.bin')
});
const upload = multer({ storage });

app.post('/api/update', async (req, res) => {
    const { deviceId, dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2, phaseName } = req.body;
    try {
        await Device.findOneAndUpdate({ deviceId }, { 
            dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2, phaseName, lastSeen: new Date()
        }, { upsert: true, new: true });

        const pendingCommand = await Command.findOne({ deviceId, executed: false }).sort({ timestamp: 1 });
        if (pendingCommand) {
            pendingCommand.executed = true; await pendingCommand.save();
            res.json({ status: "success", hasCommand: true, command: pendingCommand.command, payload: pendingCommand.payload });
        } else {
            res.json({ status: "success", hasCommand: false });
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/status/:deviceId', async (req, res) => {
    const status = await Device.findOne({ deviceId: req.params.deviceId });
    res.json(status || {});
});

app.get('/api/phases/:deviceId', async (req, res) => {
    let settings = await PhaseSettings.findOne({ deviceId: req.params.deviceId });
    if (!settings) {
        settings = { deviceId: req.params.deviceId, phases: [
            { name: "Yellowing", steps: [{db:95, wb:92}, {db:96, wb:93}, {db:98, wb:94}, {db:99, wb:95}, {db:100, wb:96}] },
            { name: "Lamina", steps: [{db:100, wb:96}, {db:102, wb:96}, {db:104, wb:97}, {db:106, wb:97}, {db:108, wb:98}] }
        ]};
    }
    res.json(settings);
});

app.post('/api/phases', async (req, res) => {
    const { deviceId, phases } = req.body;
    await PhaseSettings.findOneAndUpdate({ deviceId }, { phases }, { upsert: true, new: true });
    const newCommand = new Command({ deviceId, command: "UPDATE_PHASE_CONFIG", payload: { phases } });
    await newCommand.save();
    res.json({ status: "Phase Config Queued" });
});

app.post('/api/command', async (req, res) => {
    const newCommand = new Command({ deviceId: req.body.deviceId, command: req.body.command, payload: req.body.payload });
    await newCommand.save();
    res.json({ status: "Command Queued" });
});

app.post('/api/upload-firmware', upload.single('firmware'), async (req, res) => {
    const firmwareUrl = `https://batcuring.espserver.site/firmware/firmware.bin`;
    const newCommand = new Command({ deviceId: req.body.deviceId, command: "UPDATE_FIRMWARE", payload: { url: firmwareUrl } });
    await newCommand.save();
    res.json({ status: "OTA Command Queued" });
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));