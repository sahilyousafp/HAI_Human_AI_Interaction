using System;
using System.Text;
using HAI.Rhino.Core.Mesh;
using Xunit;

namespace HAI.Rhino.Core.Tests
{
    public class MeshAssetWriterTests
    {
        // A box 2000 x 1000 x 3000 mm with its corner at the origin: eight vertices, twelve triangles.
        private static MeshPart Box()
        {
            var positions = new float[]
            {
                0, 0, 0, 2000, 0, 0, 2000, 1000, 0, 0, 1000, 0,
                0, 0, 3000, 2000, 0, 3000, 2000, 1000, 3000, 0, 1000, 3000,
            };
            var indices = new uint[]
            {
                0, 2, 1, 0, 3, 2, // bottom
                4, 5, 6, 4, 6, 7, // top
                0, 1, 5, 0, 5, 4, // front
                1, 2, 6, 1, 6, 5, // right
                2, 3, 7, 2, 7, 6, // back
                3, 0, 4, 3, 4, 7, // left
            };
            return new MeshPart(positions, indices);
        }

        [Fact]
        public void TheBoxIsTheFixtureTheTypeScriptSideReads()
        {
            Golden.Bytes("box.haimesh", MeshAssetWriter.Encode(new[] { Box() }));
        }

        [Fact]
        public void TheHeaderNamesTheMagicAndKeepsTheDataOnAFourByteBoundary()
        {
            var bytes = MeshAssetWriter.Encode(new[] { Box() });
            Assert.Equal("HAIMESH1", Encoding.ASCII.GetString(bytes, 0, 8));
            var headerLength = (int)BitConverter.ToUInt32(bytes, 8);
            Assert.Equal(0, (12 + headerLength) % 4);
            var dataLength = bytes.Length - 12 - headerLength;
            Assert.Equal(8 * 3 * 4 + 12 * 3 * 4, dataLength);
        }

        [Fact]
        public void TheBoundsAreTheVertices()
        {
            Assert.Equal("{\"min\":[0,0,0],\"max\":[2000,1000,3000]}", MeshAssetWriter.BoundsJson(Box()));
        }

        [Fact]
        public void SeveralPartsFollowEachOther()
        {
            var triangle = new MeshPart(new float[] { 0, 0, 0, 1, 0, 0, 0, 1, 0 }, new uint[] { 0, 1, 2 });
            var bytes = MeshAssetWriter.Encode(new[] { triangle, triangle });
            var headerLength = (int)BitConverter.ToUInt32(bytes, 8);
            var header = Encoding.UTF8.GetString(bytes, 12, headerLength);
            Assert.Contains("\"position\":0,\"index\":36", header);
            Assert.Contains("\"position\":48,\"index\":84", header);
            Assert.Equal(12 + headerLength + 2 * (36 + 12), bytes.Length);
        }

        [Fact]
        public void NoPartsIsAValidEmptyAsset()
        {
            var bytes = MeshAssetWriter.Encode(Array.Empty<MeshPart>());
            Assert.Equal("HAIMESH1", Encoding.ASCII.GetString(bytes, 0, 8));
            var headerLength = (int)BitConverter.ToUInt32(bytes, 8);
            Assert.Equal(bytes.Length, 12 + headerLength);
        }

        [Fact]
        public void RefusesWhatTheReaderWouldRefuse()
        {
            Assert.Throws<ArgumentException>(() => new MeshPart(new float[] { 0, 0 }, Array.Empty<uint>()));
            Assert.Throws<ArgumentException>(() => new MeshPart(new float[] { 0, 0, 0 }, new uint[] { 0, 0 }));
            Assert.Throws<ArgumentException>(() => new MeshPart(new float[] { 0, 0, 0 }, new uint[] { 0, 0, 1 }));
            Assert.Throws<ArgumentException>(() => new MeshPart(new[] { float.NaN, 0, 0 }, Array.Empty<uint>()));
        }
    }
}
