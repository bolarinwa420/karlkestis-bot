// Combined entry point for Railway
// Runs both the revival scanner and the analysis bot in one process

require('./scanner'); // background scanner — alerts every 6h
require('./bot');     // interactive bot — responds to /analyze
