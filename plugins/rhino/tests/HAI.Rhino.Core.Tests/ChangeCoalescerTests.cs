using System;
using System.Collections.Generic;
using System.Linq;
using HAI.Rhino.Core.Changes;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    /// <summary>A clock the tests move by hand.</summary>
    internal sealed class ManualScheduler : IScheduler
    {
        private readonly List<Entry> entries = new List<Entry>();
        private TimeSpan now = TimeSpan.Zero;

        private sealed class Entry : IDisposable
        {
            public TimeSpan At;
            public Action? Action;
            public void Dispose() => Action = null;
        }

        public IDisposable Schedule(TimeSpan delay, Action action)
        {
            var entry = new Entry { At = now + delay, Action = action };
            entries.Add(entry);
            return entry;
        }

        public int Waiting => entries.Count(e => e.Action != null);

        public void Advance(TimeSpan by)
        {
            now += by;
            foreach (var entry in entries.Where(e => e.Action != null && e.At <= now).ToList())
            {
                var action = entry.Action;
                entry.Action = null;
                action?.Invoke();
            }

            entries.RemoveAll(e => e.Action == null);
        }
    }

    public class ChangeCoalescerTests
    {
        private static readonly TimeSpan Window = TimeSpan.FromMilliseconds(100);

        private static (ChangeCoalescer coalescer, ManualScheduler clock, List<ChangeSet> batches) Setup()
        {
            var clock = new ManualScheduler();
            var batches = new List<ChangeSet>();
            return (new ChangeCoalescer(Window, clock, batches.Add), clock, batches);
        }

        [Fact]
        public void ABurstOfThirtyChangesIsOneBatch()
        {
            var (coalescer, clock, batches) = Setup();
            var ids = Enumerable.Range(0, 30).Select(_ => Guid.NewGuid()).ToList();
            foreach (var id in ids)
            {
                coalescer.Changed(id);
                clock.Advance(TimeSpan.FromMilliseconds(2));
            }

            Assert.Empty(batches); // the window is still open
            clock.Advance(TimeSpan.FromMilliseconds(100));
            var batch = Assert.Single(batches);
            Assert.Equal(ids, batch.Changed.ToList());
            Assert.Empty(batch.Deleted);
        }

        [Fact]
        public void TheWindowOpensWithTheFirstChangeSoNothingWaitsLongerThanIt()
        {
            var (coalescer, clock, batches) = Setup();
            coalescer.Changed(Guid.NewGuid());
            clock.Advance(TimeSpan.FromMilliseconds(60));
            coalescer.Changed(Guid.NewGuid()); // a later change does not push the batch back
            clock.Advance(TimeSpan.FromMilliseconds(39));
            Assert.Empty(batches);
            clock.Advance(TimeSpan.FromMilliseconds(1));
            Assert.Equal(2, Assert.Single(batches).Changed.Count);
        }

        [Fact]
        public void AnObjectChangedSeveralTimesIsListedOnce()
        {
            var (coalescer, clock, batches) = Setup();
            var id = Guid.NewGuid();
            for (var i = 0; i < 5; i++) coalescer.Changed(id);
            clock.Advance(Window);
            Assert.Equal(new[] { id }, Assert.Single(batches).Changed.ToArray());
        }

        [Fact]
        public void AnObjectRemovedAfterItWasChangedIsOnlyRemoved()
        {
            var (coalescer, clock, batches) = Setup();
            var id = Guid.NewGuid();
            coalescer.Changed(id);
            coalescer.Deleted(id);
            clock.Advance(Window);
            var batch = Assert.Single(batches);
            Assert.Empty(batch.Changed);
            Assert.Equal(new[] { id }, batch.Deleted.ToArray());
        }

        [Fact]
        public void AnObjectThatComesBackAfterItWasRemovedIsOnlyChanged()
        {
            var (coalescer, clock, batches) = Setup();
            var id = Guid.NewGuid();
            coalescer.Deleted(id);
            coalescer.Changed(id); // an undo
            clock.Advance(Window);
            var batch = Assert.Single(batches);
            Assert.Equal(new[] { id }, batch.Changed.ToArray());
            Assert.Empty(batch.Deleted);
        }

        [Fact]
        public void ChangesAfterABatchOpenTheNextWindow()
        {
            var (coalescer, clock, batches) = Setup();
            coalescer.Changed(Guid.NewGuid());
            clock.Advance(Window);
            coalescer.Changed(Guid.NewGuid());
            Assert.Single(batches);
            clock.Advance(Window);
            Assert.Equal(2, batches.Count);
        }

        [Fact]
        public void NothingChangedIsNoBatch()
        {
            var (coalescer, clock, batches) = Setup();
            coalescer.Flush();
            clock.Advance(TimeSpan.FromSeconds(1));
            Assert.Empty(batches);
        }

        [Fact]
        public void FlushSendsAtOnceAndTheClosedWindowDoesNotSendAgain()
        {
            var (coalescer, clock, batches) = Setup();
            coalescer.Changed(Guid.NewGuid());
            coalescer.Flush();
            Assert.Single(batches);
            Assert.Equal(0, clock.Waiting);
            clock.Advance(Window);
            Assert.Single(batches);
        }

        [Fact]
        public void DisposedItSendsNothingMore()
        {
            var (coalescer, clock, batches) = Setup();
            coalescer.Changed(Guid.NewGuid());
            coalescer.Dispose();
            clock.Advance(Window);
            coalescer.Changed(Guid.NewGuid());
            clock.Advance(Window);
            Assert.Empty(batches);
        }
    }
}
