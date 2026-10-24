using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace HAI.Rhino.Core.Mesh
{
    /// <summary>One piece of a mesh: three numbers per vertex (millimetres) and three vertex numbers per triangle.</summary>
    public sealed class MeshPart
    {
        public float[] Positions { get; }
        public uint[] Indices { get; }

        public MeshPart(float[] positions, uint[] indices)
        {
            if (positions.Length % 3 != 0) throw new ArgumentException("Positions need three numbers per vertex.");
            if (indices.Length % 3 != 0) throw new ArgumentException("Indices need three numbers per triangle.");
            var vertices = positions.Length / 3;
            foreach (var index in indices)
                if (index >= vertices) throw new ArgumentException("A triangle names a vertex that does not exist.");
            foreach (var value in positions)
                if (float.IsNaN(value) || float.IsInfinity(value))
                    throw new ArgumentException("A vertex position is not a finite number.");
            Positions = positions;
            Indices = indices;
        }

        public int Triangles => Indices.Length / 3;
    }

    /// <summary>
    /// Writes the binary container HAI reads for geometry (packages/scene/src/mesh-asset.ts): "HAIMESH1", the header's
    /// length, a JSON header padded with spaces to a multiple of four bytes, then little-endian Float32 positions and
    /// Uint32 indices, part after part. A fixture written here is read by the TypeScript side in a contract test.
    /// </summary>
    public static class MeshAssetWriter
    {
        private const string Magic = "HAIMESH1";

        public static byte[] Encode(IReadOnlyList<MeshPart> parts)
        {
            var header = new StringBuilder("{\"parts\":[");
            long offset = 0;
            for (var i = 0; i < parts.Count; i++)
            {
                var part = parts[i];
                var positionBytes = (long)part.Positions.Length * 4;
                var indexBytes = (long)part.Indices.Length * 4;
                if (i > 0) header.Append(',');
                header.Append("{\"vertices\":").Append(part.Positions.Length / 3)
                    .Append(",\"indices\":").Append(part.Indices.Length)
                    .Append(",\"position\":").Append(offset)
                    .Append(",\"index\":").Append(offset + positionBytes)
                    .Append(",\"bounds\":").Append(BoundsJson(part)).Append('}');
                offset += positionBytes + indexBytes;
            }

            header.Append("]}");
            // The data starts on a four-byte boundary: magic (8) + length (4) + header must be a multiple of four.
            while ((Magic.Length + 4 + header.Length) % 4 != 0) header.Append(' ');
            var json = Encoding.UTF8.GetBytes(header.ToString());

            using (var stream = new MemoryStream())
            using (var writer = new BinaryWriter(stream))
            {
                writer.Write(Encoding.ASCII.GetBytes(Magic));
                writer.Write((uint)json.Length);
                writer.Write(json);
                foreach (var part in parts)
                {
                    foreach (var value in part.Positions) writer.Write(value);
                    foreach (var index in part.Indices) writer.Write(index);
                }

                writer.Flush();
                return stream.ToArray();
            }
        }

        /// <summary>The bounding box of a part's vertices as {"min":[x,y,z],"max":[x,y,z]}.</summary>
        public static string BoundsJson(MeshPart part)
        {
            var min = new[] { float.PositiveInfinity, float.PositiveInfinity, float.PositiveInfinity };
            var max = new[] { float.NegativeInfinity, float.NegativeInfinity, float.NegativeInfinity };
            for (var i = 0; i < part.Positions.Length; i += 3)
            {
                for (var k = 0; k < 3; k++)
                {
                    var value = part.Positions[i + k];
                    if (value < min[k]) min[k] = value;
                    if (value > max[k]) max[k] = value;
                }
            }

            if (part.Positions.Length == 0)
            {
                min = new float[3];
                max = new float[3];
            }

            string Triple(float[] v) =>
                "[" + string.Join(",", Array.ConvertAll(v, n => n.ToString("R", CultureInfo.InvariantCulture))) + "]";
            return "{\"min\":" + Triple(min) + ",\"max\":" + Triple(max) + "}";
        }
    }
}
