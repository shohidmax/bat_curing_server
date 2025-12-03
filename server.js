const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
 
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(bodyParser.json());

// MongoDB Connection
const uri = "mongodb+srv://shohidmax_db_user:ZdTUKDQ9Z0sgKIjk@batb.ryu6iku.mongodb.net/tobacco_curing?retryWrites=true&w=majority&appName=batb";

mongoose.connect(uri)
  .then(() => console.log("MongoDB Connected Successfully!"))
  .catch(err => console.log("MongoDB Connection Error: ", err));

// --- SCHEMAS ---

// Device Status Schema
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

// Advanced Phase Settings Schema (UPDATED)
const PhaseSettingsSchema = new mongoose.Schema({
    deviceId: { type: String, required: true, unique: true },
    phases: [{
        id: String,       // Unique ID for phase
        name: String,     // Phase Name (e.g. Yellowing)
        steps: [{         // Array of hourly settings
            hour: Number,
            db: Number,
            wb: Number
        }]
    }]
});

// Command Schema
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

// --- ROUTES ---

// Update Status from Device
app.post('/api/update', async (req, res) => {
    const { deviceId, dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2 } = req.body;

    try {
        await Device.findOneAndUpdate(
            { deviceId },
            { 
                dryTemp, wetTemp, setDryTemp, setWetTemp, phase, mode, relay1, relay2,
                lastSeen: new Date()
            },
            { upsert: true, new: true }
        );

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

// Get Device Status
app.get('/api/status/:deviceId', async (req, res) => {
    try {
        const status = await Device.findOne({ deviceId: req.params.deviceId });
        res.json(status || {});
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Phase Settings (Detailed)
app.get('/api/phases/:deviceId', async (req, res) => {
    try {
        let settings = await PhaseSettings.findOne({ deviceId: req.params.deviceId });
        
        // Default Data if empty
        if (!settings) {
            settings = {
                deviceId: req.params.deviceId,
                phases: [
                    { 
                        id: "p1", 
                        name: "Yellowing", 
                        steps: [
                            { hour: 1, db: 95, wb: 92 },
                            { hour: 2, db: 96, wb: 93 },
                            { hour: 3, db: 98, wb: 94 }
                        ] 
                    }
                ]
            };
        }
        res.json(settings);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Save Phase Settings
app.post('/api/phases', async (req, res) => {
    const { deviceId, phases } = req.body;
    try {
        await PhaseSettings.findOneAndUpdate(
            { deviceId },
            { phases },
            { upsert: true, new: true }
        );

        // Queue update command for ESP32
        const newCommand = new Command({ 
            deviceId, 
            command: "UPDATE_PHASE_CONFIG", 
            payload: { phases } 
        });
        await newCommand.save();

        res.json({ status: "Advanced Phase settings updated" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send Manual Command
app.post('/api/command', async (req, res) => {
    const { deviceId, command, payload } = req.body;
    try {
        const newCommand = new Command({ deviceId, command, payload });
        await newCommand.save();
        res.json({ status: "Command queued successfully" });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});