using System;
using System.Diagnostics;
using System.Drawing.Imaging;
using System.IO;
using HAI.Rhino.Core.Protocol;
using Rhino;
using Rhino.Display;

namespace HAI.Rhino
{
    /// <summary>
    /// Captures Rhino's own viewport as a PNG, for the agent to check its work: the active view as it is, or one of HAI's
    /// named views. A named view is shown only for the capture, then the viewport goes back to where the user had it.
    /// </summary>
    internal static class Capture
    {
        /// <summary>Renders the picture on the UI thread; null and why when it cannot.</summary>
        public static (byte[]? Png, string? Error, double Ms) Take(RhinoDoc doc, CaptureRequest request)
        {
            var clock = Stopwatch.StartNew();
            var view = doc.Views.ActiveView;
            if (view == null) return (null, "Rhino has no active view.", clock.Elapsed.TotalMilliseconds);
            var width = Math.Max(64, Math.Min(1280, request.Width));
            var height = Math.Max(64, Math.Min(1280, request.Height));
            var viewport = view.ActiveViewport;
            var named = Projection(request.View);
            if (named.HasValue) viewport.PushViewProjection();
            try
            {
                if (named.HasValue)
                {
                    viewport.SetProjection(named.Value, null, true);
                    viewport.ZoomExtents();
                }

                var capture = new ViewCapture
                {
                    Width = width,
                    Height = height,
                    ScaleScreenItems = false,
                    DrawAxes = false,
                    DrawGrid = false,
                    DrawGridAxes = false,
                    TransparentBackground = false,
                };
                using (var bitmap = capture.CaptureToBitmap(view))
                {
                    if (bitmap == null) return (null, "Rhino could not draw the view.", clock.Elapsed.TotalMilliseconds);
                    using (var png = new MemoryStream())
                    {
                        bitmap.Save(png, ImageFormat.Png);
                        return (png.ToArray(), null, clock.Elapsed.TotalMilliseconds);
                    }
                }
            }
            catch (Exception error)
            {
                return (null, Limits.Clip("The capture failed: " + error.Message, Limits.Error), clock.Elapsed.TotalMilliseconds);
            }
            finally
            {
                if (named.HasValue)
                {
                    viewport.PopViewProjection();
                    view.Redraw();
                }
            }
        }

        /// <summary>HAI's named views as Rhino's own projections; null for the active view as it is.</summary>
        private static DefinedViewportProjection? Projection(string? view)
        {
            switch (view)
            {
                case "top": return DefinedViewportProjection.Top;
                case "bottom": return DefinedViewportProjection.Bottom;
                case "front": return DefinedViewportProjection.Front;
                case "back": return DefinedViewportProjection.Back;
                case "left": return DefinedViewportProjection.Left;
                case "right": return DefinedViewportProjection.Right;
                case "perspective": return DefinedViewportProjection.Perspective;
                default: return null;
            }
        }
    }
}
