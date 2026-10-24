using System;
using System.Collections.Generic;

namespace HAI.Rhino.Core.Changes
{
    /// <summary>Starts a delayed action; the plugin uses a timer, the tests a clock they move by hand.</summary>
    public interface IScheduler
    {
        IDisposable Schedule(TimeSpan delay, Action action);
    }

    /// <summary>What changed in the document during one window: objects added or replaced, and objects removed.</summary>
    public sealed class ChangeSet
    {
        public IReadOnlyCollection<Guid> Changed { get; }
        public IReadOnlyCollection<Guid> Deleted { get; }

        public ChangeSet(IReadOnlyCollection<Guid> changed, IReadOnlyCollection<Guid> deleted)
        {
            Changed = changed;
            Deleted = deleted;
        }
    }

    /// <summary>
    /// Collects the document's change events for a short window and hands them over as one batch. The first event
    /// opens the window; everything that happens before it closes joins the same batch, so a script that touches
    /// thirty objects is one batch, not thirty, and the delay a change can suffer is bounded by the window. An object
    /// changed several times is listed once; one removed after it was changed is only removed; one that comes back
    /// (an undo) after it was removed is only changed.
    /// </summary>
    public sealed class ChangeCoalescer : IDisposable
    {
        private readonly object gate = new object();
        private readonly TimeSpan window;
        private readonly Action<ChangeSet> onBatch;
        private readonly IScheduler scheduler;
        private readonly List<Guid> changedOrder = new List<Guid>();
        private readonly HashSet<Guid> changed = new HashSet<Guid>();
        private readonly HashSet<Guid> deleted = new HashSet<Guid>();
        private IDisposable? pending;
        private bool disposed;

        public ChangeCoalescer(TimeSpan window, IScheduler scheduler, Action<ChangeSet> onBatch)
        {
            this.window = window;
            this.scheduler = scheduler;
            this.onBatch = onBatch;
        }

        /// <summary>An object was added, replaced, moved or its attributes changed.</summary>
        public void Changed(Guid id)
        {
            lock (gate)
            {
                if (disposed) return;
                deleted.Remove(id);
                if (changed.Add(id)) changedOrder.Add(id);
                Open();
            }
        }

        /// <summary>An object was removed.</summary>
        public void Deleted(Guid id)
        {
            lock (gate)
            {
                if (disposed) return;
                if (changed.Remove(id)) changedOrder.Remove(id);
                deleted.Add(id);
                Open();
            }
        }

        /// <summary>Sends what has been collected now, without waiting for the window to close.</summary>
        public void Flush()
        {
            ChangeSet? batch;
            lock (gate)
            {
                batch = Take();
            }

            if (batch != null) onBatch(batch);
        }

        public void Dispose()
        {
            lock (gate)
            {
                disposed = true;
                pending?.Dispose();
                pending = null;
                changed.Clear();
                changedOrder.Clear();
                deleted.Clear();
            }
        }

        private void Open()
        {
            if (pending != null) return;
            pending = scheduler.Schedule(window, Flush);
        }

        private ChangeSet? Take()
        {
            pending?.Dispose();
            pending = null;
            if (changedOrder.Count == 0 && deleted.Count == 0) return null;
            var batch = new ChangeSet(changedOrder.ToArray(), new List<Guid>(deleted).ToArray());
            changedOrder.Clear();
            changed.Clear();
            deleted.Clear();
            return batch;
        }
    }

    /// <summary>The plugin's scheduler: one timer per window.</summary>
    public sealed class TimerScheduler : IScheduler
    {
        public IDisposable Schedule(TimeSpan delay, Action action)
        {
            System.Threading.Timer? timer = null;
            timer = new System.Threading.Timer(
                _ =>
                {
                    timer?.Dispose();
                    action();
                },
                null,
                delay,
                System.Threading.Timeout.InfiniteTimeSpan);
            return timer;
        }
    }
}
