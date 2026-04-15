// ============================================
// Meta API — Backward compatibility re-exports
// The real implementation is in ./meta/ directory
// ============================================

export { getPageToken, getUserProfile } from "./meta/client";
export { sendMessage, sendTypingIndicator } from "./meta/messenger";
export { replyToComment, handleCommentEngagement } from "./meta/comments";
