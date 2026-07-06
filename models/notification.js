import mongoose from 'mongoose'

const notificationSchema = new mongoose.Schema({
  forAdmin: {
    type: Boolean,
    default: false
  },
  recipient: {                          // 👈 AJOUTÉ — pour cibler un user précis (ex: l'assigné)
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

export default mongoose.model('Notification', notificationSchema)