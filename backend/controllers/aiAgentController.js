const aiAgentService = require('../services/aiAgentService');

async function chat(req, res, next) {
  try {
    const result = await aiAgentService.runAgent({
      message: req.body?.message,
      mode: req.body?.mode,
      context: req.body?.context || {},
      user: req.user || null
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  chat
};
