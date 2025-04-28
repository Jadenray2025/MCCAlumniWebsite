// Chat functionality
let chatForm;
let messageInput;
let chatMessages;
let userCount;
let typingTimeout;
let isTyping = false;

// Track if retention notice has been shown
let retentionNoticeShown = false;

// List of adjectives and animals for generating anonymous names
const adjectives = ['Silent', 'Swift', 'Mystic', 'Shadow', 'Hidden', 'Secret', 'Masked', 'Unknown', 'Stealth', 'Cryptic'];
const animals = ['Fox', 'Wolf', 'Owl', 'Raven', 'Panther', 'Hawk', 'Eagle', 'Lion', 'Tiger', 'Bear'];

// Track processed message IDs globally
const processedMessageIds = new Set();

// Generate a random anonymous name
function generateAnonymousName() {
    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const animal = animals[Math.floor(Math.random() * animals.length)];
    const number = Math.floor(Math.random() * 1000);
    return `${adjective}_${animal}_${number}`;
}

// Store user's anonymous name and last update time
let userAnonymousName = localStorage.getItem('anonymousName') || generateAnonymousName();
let lastNameUpdate = localStorage.getItem('lastNameUpdate') || Date.now();
localStorage.setItem('anonymousName', userAnonymousName);
localStorage.setItem('lastNameUpdate', lastNameUpdate);

// Function to add a message to the chat UI
function addMessageToUI(message, isSystem = false) {
    try {
        const messageElement = document.createElement('div');
        messageElement.className = `message ${isSystem ? 'system-message' : 'user-message'}`;
        messageElement.dataset.messageId = message.id;
        
        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';
        
        if (!isSystem) {
            const usernameSpan = document.createElement('span');
            usernameSpan.className = 'message-username';
            usernameSpan.textContent = message.username;
            messageContent.appendChild(usernameSpan);
        }
        
        const textSpan = document.createElement('span');
        textSpan.className = 'message-text';
        textSpan.textContent = isSystem ? message : message.text;
        messageContent.appendChild(textSpan);
        
        // Add delete button if message is from current user
        if (!isSystem && message.username === userAnonymousName) {
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-message-btn';
            deleteButton.innerHTML = '<i class="fas fa-trash"></i>';
            deleteButton.title = 'Delete message';
            deleteButton.onclick = () => deleteMessage(message.id);
            messageContent.appendChild(deleteButton);
        }
        
        messageElement.appendChild(messageContent);
        chatMessages.appendChild(messageElement);
        
        // Scroll to bottom
        chatMessages.scrollTop = chatMessages.scrollHeight;
    } catch (error) {
        console.error('Error adding message to UI:', error);
    }
}

// Function to delete a message
async function deleteMessage(messageId) {
    try {
        if (!window.database) {
            throw new Error('Database not initialized');
        }
        
        const messageRef = window.dbRef(window.database, `messages/${messageId}`);
        
        // Get the message to verify ownership
        const messageSnapshot = await window.dbGet(messageRef);
        const message = messageSnapshot.val();
        
        if (!message) {
            console.log('Message already deleted');
            return;
        }
        
        if (message.username !== userAnonymousName) {
            console.log('Cannot delete other users\' messages');
            return;
        }
        
        // Delete the message
        await window.dbSet(messageRef, null);
        
        // Remove from UI
        const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
        if (messageElement) {
            messageElement.remove();
        }
        
        // Remove from processed set
        processedMessageIds.delete(messageId);
        
        console.log('Message deleted successfully');
    } catch (error) {
        console.error('Error deleting message:', error);
        addMessageToUI('Error deleting message. Please try again.', true);
    }
}

// Function to show retention notice
function showRetentionNotice() {
    if (!retentionNoticeShown) {
        const retentionNotice = document.createElement('div');
        retentionNotice.className = 'message system-message retention-notice';
        retentionNotice.textContent = 'Messages are automatically deleted after 1 hour for security';
        chatMessages.appendChild(retentionNotice);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        // Remove retention notice after 10 seconds
        setTimeout(() => {
            retentionNotice.style.opacity = '0';
            setTimeout(() => {
                retentionNotice.remove();
            }, 500); // Wait for fade out animation to complete
        }, 10000);

        retentionNoticeShown = true;
    }
}

// Function to check if user can send message (anti-spam)
function canSendMessage() {
    const now = Date.now();
    const history = JSON.parse(localStorage.getItem('messageHistory') || '[]');
    // Remove messages older than 1 minute
    const recent = history.filter(ts => now - ts < 60 * 1000);
    if (recent.length >= 10) return false;
    recent.push(now);
    localStorage.setItem('messageHistory', JSON.stringify(recent));
    return true;
}

// Function to get user's IP address
async function getUserIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.error('Error getting IP:', error);
        return 'unknown';
    }
}

// Track online users
function trackUserPresence() {
    try {
        if (!window.database) {
            throw new Error('Database not initialized');
        }
        
        // Use a simpler presence tracking that doesn't require write permissions
        const userRef = window.dbRef(window.database, 'presence');
        let isOnline = true;
        
        // Set initial online status
        updatePresence();
        
        // Update presence status periodically
        const presenceInterval = setInterval(updatePresence, 30000);
        
        // Set offline when leaving
        window.addEventListener('beforeunload', () => {
            isOnline = false;
            clearInterval(presenceInterval);
        });
        
        function updatePresence() {
            if (!isOnline) {
                clearInterval(presenceInterval);
                return;
            }
            
            // Just read the presence data, don't try to write
            window.dbOnValue(userRef, (snapshot) => {
                const data = snapshot.val();
                if (data) {
                    const onlineUsers = Object.keys(data).length;
                    userCount.textContent = `${onlineUsers} users online`;
                }
            });
        }
    } catch (error) {
        console.error('Error initializing presence tracking:', error);
    }
}

// Function to send a message
async function sendMessage(messageText) {
    try {
        if (!window.database) {
            throw new Error('Database not initialized');
        }
        
        if (messageText.trim() === '') return;
        
        // Check anti-spam
        if (!canSendMessage()) {
            addMessageToUI('You can only send 10 messages every 1 minute. Please wait.', true);
            return;
        }
        
        const timestamp = Date.now();
        const ip = await getUserIP();
        const expiresAt = timestamp + (60 * 60 * 1000); // 1 hour from now
        
        const messageData = {
            text: messageText,
            username: userAnonymousName,
            timestamp: timestamp,
            ip: ip,
            expiresAt: expiresAt
        };
        
        // Add message to Firebase
        const messagesRef = window.dbRef(window.database, 'messages');
        const newMessageRef = window.dbPush(messagesRef);
        const messageId = newMessageRef.key;
        
        // Add message ID to data
        messageData.id = messageId;
        
        // Add to processed set immediately to prevent duplicates
        processedMessageIds.add(messageId);
        
        // Add message to UI immediately
        addMessageToUI(messageData);
        
        // Then save to database
        await window.dbSet(newMessageRef, messageData);
        
        // Clear input
        messageInput.value = '';

        // Show retention notice only if it hasn't been shown before
        showRetentionNotice();
    } catch (error) {
        console.error('Error sending message:', error);
        addMessageToUI('Error sending message. Please try again.', true);
    }
}

// Load previous messages and set up message listener
function initializeMessages() {
    try {
        if (!window.database) {
            throw new Error('Database not initialized');
        }
        
        const messagesRef = window.dbRef(window.database, 'messages');
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        // Set up query for messages from the last hour
        const messagesQuery = window.dbQuery(
            messagesRef,
            window.dbOrderByChild('timestamp'),
            window.dbStartAt(oneHourAgo)
        );
        
        // Listen for all messages (both existing and new)
        window.dbOnValue(messagesQuery, (snapshot) => {
            try {
                const messages = [];
                snapshot.forEach((childSnapshot) => {
                    const message = childSnapshot.val();
                    const messageId = childSnapshot.key;
                    
                    // Skip if message is null (deleted) or we've already processed it
                    if (!message || processedMessageIds.has(messageId)) {
                        return;
                    }
                    
                    // Add message ID to processed set
                    processedMessageIds.add(messageId);
                    
                    // Only show messages that haven't expired
                    if (message.expiresAt > now) {
                        message.id = messageId;
                        messages.push(message);
                    }
                });
                
                // Sort messages by timestamp
                messages.sort((a, b) => a.timestamp - b.timestamp);
                
                // Add messages to UI
                messages.forEach(msg => {
                    // Check if message already exists in UI
                    const existingMessage = document.querySelector(`[data-message-id="${msg.id}"]`);
                    if (!existingMessage) {
                        addMessageToUI(msg);
                    }
                });
                
                console.log('Processed messages:', messages.length);
            } catch (error) {
                console.error('Error processing messages:', error);
            }
        });

        // Listen for message deletions
        window.dbOnChildRemoved(messagesRef, (snapshot) => {
            const messageId = snapshot.key;
            const messageElement = document.querySelector(`[data-message-id="${messageId}"]`);
            if (messageElement) {
                messageElement.remove();
            }
            // Remove from processed set
            processedMessageIds.delete(messageId);
        });
    } catch (error) {
        console.error('Error initializing messages:', error);
        addMessageToUI('Error initializing messages. Please refresh the page.', true);
    }
}

// Add some style to the messages
function addStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .message-time {
            font-size: 0.8em;
            color: #aaa;
            margin-left: 10px;
        }
        
        .message-username {
            font-weight: bold;
            color: #7289da;
        }

        .delete-message-btn {
            background: none;
            border: none;
            color: #ff6b6b;
            cursor: pointer;
            padding: 5px;
            margin-left: 10px;
            opacity: 0.5;
            transition: opacity 0.3s ease;
        }

        .delete-message-btn:hover {
            opacity: 1;
        }

        .message:hover .delete-message-btn {
            opacity: 0.7;
        }
    `;
    document.head.appendChild(style);
}

// Function to show typing indicator
function showTypingIndicator() {
    if (!isTyping) {
        isTyping = true;
        const typingIndicator = document.getElementById('typingIndicator');
        typingIndicator.innerHTML = '<div class="typing-dots"><span>.</span><span>.</span><span>.</span></div>';
        typingIndicator.classList.add('active');
    }
}

// Function to hide typing indicator
function hideTypingIndicator() {
    isTyping = false;
    const typingIndicator = document.getElementById('typingIndicator');
    typingIndicator.classList.remove('active');
}

// Function to show welcome notification
function showWelcomeNotification() {
    const welcomeNotification = document.getElementById('welcomeNotification');
    welcomeNotification.textContent = `Welcome to KNOW-ME-NOT, ${userAnonymousName}! Have fun making friends anonymously.`;
    welcomeNotification.style.display = 'block';
    
    // Remove the notification after 8 seconds
    setTimeout(() => {
        welcomeNotification.style.display = 'none';
    }, 8000);
}

// Function to check and update anonymous name
function checkAndUpdateAnonymousName() {
    const currentTime = Date.now();
    const threeHoursInMs = 3 * 60 * 60 * 1000; // 3 hours in milliseconds
    
    if (currentTime - lastNameUpdate >= threeHoursInMs) {
        const oldName = userAnonymousName;
        userAnonymousName = generateAnonymousName();
        lastNameUpdate = currentTime;
        
        // Update localStorage
        localStorage.setItem('anonymousName', userAnonymousName);
        localStorage.setItem('lastNameUpdate', lastNameUpdate);
        
        // Notify user of name change
        addMessageToUI(`Your anonymous name has been updated from ${oldName} to ${userAnonymousName}`, true);
        
        // Update user presence in database
        updateUserPresence();
    }
}

// Function to update user presence with new name
function updateUserPresence() {
    try {
        if (!window.database) {
            throw new Error('Database not initialized');
        }
        
        const userRef = window.dbRef(window.database, `users/${userAnonymousName}`);
        
        // Set user as online with new name
        window.dbSet(userRef, {
            status: 'online',
            lastActive: Date.now()
        }).catch(error => {
            console.warn('Error updating user presence:', error);
        });
    } catch (error) {
        console.error('Error updating user presence:', error);
    }
}

// Initialize chat
function initializeChat() {
    try {
        // Get DOM elements
        chatForm = document.getElementById('chat-form');
        messageInput = document.getElementById('message-input');
        chatMessages = document.getElementById('chat-messages');
        userCount = document.getElementById('userCount');

        if (!window.database) {
            throw new Error('Firebase database not initialized');
        }

        // Check and update anonymous name if needed
        checkAndUpdateAnonymousName();

        // Show welcome notification
        showWelcomeNotification();

        // Add event listener for form submission
        chatForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const message = messageInput.value.trim();
            if (message) {
                await sendMessage(message);
                hideTypingIndicator();
            }
        });

        // Add typing indicator functionality
        messageInput.addEventListener('input', () => {
            showTypingIndicator();
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(hideTypingIndicator, 2000);
        });

        // Add styles
        addStyles();

        // Initialize chat features
        trackUserPresence();
        initializeMessages();

        // Set up periodic name check
        setInterval(checkAndUpdateAnonymousName, 60 * 1000); // Check every minute
    } catch (error) {
        console.error('Error initializing chat:', error);
        addMessageToUI('Error initializing chat. Please refresh the page.', true);
    }
}

// Wait for DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeChat); 