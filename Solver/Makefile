CXX ?= g++
CXXFLAGS ?= -O3 -std=c++17 -DNDEBUG -Wall -Wextra -Wpedantic
all: kunsolve
kunsolve: solver.cpp
	$(CXX) $(CXXFLAGS) -o $@ $<
# Committed prebuilt binary: static (no libstdc++/glibc version dependency) and stripped.
release: solver.cpp
	$(CXX) $(CXXFLAGS) -static -s -o kunsolve-linux-x86_64 $<
clean:
	rm -f kunsolve
