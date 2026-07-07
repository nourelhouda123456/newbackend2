import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  forAdmin: {
    type: Boolean,
    default: false
  },
  recipient: {                          
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sender: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  task: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    default: null
  },
  project: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Project',
    default: null
  },
  type: {
    type: String,
    enum: ['REOPEN_REQUEST', 'COMMENT', 'INFO', 'DEADLINE_ALERT', 'APPROVE', 'IGNORE'],
    default: 'INFO'
  },
  message: {
    type: String,
    required: true
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, { timestamps: true })

notificationSchema.set('toJSON', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  }
})

notificationSchema.set('toObject', {
  virtuals: true,
  transform: (doc, ret) => {
    ret.id = ret._id.toString()
    delete ret._id
    delete ret.__v
    return ret
  }
})

// Trigger Firebase Cloud Messaging after saving a new notification
import { sendPushNotification } from '../firebase.js';

// We use post('save') but we check if doc.createdAt === doc.updatedAt (or close enough) to know it's a new document
notificationSchema.post('save', async function(doc) {
  try {
    const isNew = doc.createdAt.getTime() === doc.updatedAt.getTime();
    if (!isNew) return; // Only send push notification on creation

    await doc.populate('recipient', 'name fcmToken');
    if (doc.recipient && doc.recipient.fcmToken) {
      await sendPushNotification(
        doc.recipient.fcmToken,
        'Nouvelle Notification TaskFlow',
        doc.message,
        {
          notificationId: doc._id.toString(),
          type: doc.type,
        }
      );
    }
  } catch (error) {
    console.error('Error in notification post-save hook:', error);
  }
});

export default mongoose.model('Notification', notificationSchema)